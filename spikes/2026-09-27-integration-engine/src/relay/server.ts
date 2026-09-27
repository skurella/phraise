// New for this spike (brief 04, src/relay/). Hocuspocus 4.7 as a library,
// per plan section 6: `startRelay(opts) -> RelayHandle`, in-process.
// `cli.ts` wraps this for a child-process run. The relay calls only
// `engine`, `git` and the opaque `crdt` handles it is handed (a `Document`
// IS a `Y.Doc`, passed straight into crdt/engine functions typed as the
// opaque `CrdtDoc`) -- it never calls a Yjs API itself (enforced by
// `test/import-boundary.test.ts`'s extended check: this directory may
// import `@hocuspocus/server`/`/extension-sqlite`, never `yjs`).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import type { Document as HpDocument } from '@hocuspocus/server';
import { read, recordAttribution, type CrdtDoc } from '../crdt/index.js';
import { attachIntegration, markEditor } from '../engine/index.js';
import { GitStore } from '../git/index.js';
import { parseDocName, makeDocName, docId as makeDocId } from './docName.js';
import { seedOrRestore } from './seeding.js';
import { checkForgery, ForgedIdentityError } from './forgery.js';
import { RelayState, type BranchState } from './state.js';
import { flushBranch } from './flush.js';
import { TrailingDebounce } from './debounce.js';
import { commitDocument } from './commit.js';
import { HeadPoller } from './poller.js';
import { handleHttpRequest } from './http.js';

export interface RelayTimings {
  /** Trailing debounce for the draft flusher, ms. Default 2000. */
  flushDebounceMs?: number;
  /** Maximum interval between flushes even under continuous edits, ms. Default 60000. */
  flushMaxIntervalMs?: number;
  /** Brief 06: how often the head poller checks `remoteHead` per branch with open documents, ms. Default 1000; gates use 100-250. */
  pollMs?: number;
  /** Brief 06 task 1: how long a document's recovery window stays open after it is freshly seeded or restored (from having no local base), ms. Default 60000. */
  recoveryWindowMs?: number;
}

export interface RelayOptions {
  port: number;
  /** Directory for this relay's own state: the SQLite document store and its git cache repository. */
  dataDir: string;
  /** The remote git repository (URL or filesystem path) this relay serves documents from. */
  remote: string;
  timings?: RelayTimings;
}

export interface RelayHandle {
  port: number;
  baseUrl: string;
  wsUrl: string;
  stop(): Promise<void>;
  /** In-process convenience: read straight from this relay's own state (child-process relays use HTTP `/health` instead -- see `src/testkit/relayHarness.ts`). */
  state: RelayState;
}

function isConnectionOrigin(origin: unknown): boolean {
  return typeof origin === 'object' && origin !== null && (origin as { source?: unknown }).source === 'connection';
}

function contentKey(document: CrdtDoc): string {
  return JSON.stringify(read(document).toJSON());
}

export async function startRelay(opts: RelayOptions): Promise<RelayHandle> {
  await fs.promises.mkdir(opts.dataDir, { recursive: true });
  const dbPath = path.join(opts.dataDir, 'documents.sqlite');
  const cacheDir = path.join(opts.dataDir, 'git-cache.git');

  const gitStore = new GitStore({ cacheDir, remoteUrl: opts.remote });
  await gitStore.init();

  const state = new RelayState(gitStore);
  const flushDebounceMs = opts.timings?.flushDebounceMs ?? 2000;
  const flushMaxIntervalMs = opts.timings?.flushMaxIntervalMs ?? 60000;
  const pollMs = opts.timings?.pollMs ?? 1000;
  const recoveryWindowMs = opts.timings?.recoveryWindowMs ?? 60000;
  const debouncers = new Map<string, TrailingDebounce>();
  const poller = new HeadPoller(gitStore, state, pollMs);

  function debouncerFor(branch: string): TrailingDebounce {
    let d = debouncers.get(branch);
    if (!d) {
      d = new TrailingDebounce(flushDebounceMs, flushMaxIntervalMs, () =>
        state.queue.run(branch, () => flushBranch(gitStore, state.branchState(branch), state.counters).then(() => undefined)),
      );
      debouncers.set(branch, d);
    }
    return d;
  }

  const contentCache = new WeakMap<object, string>();

  const server = new Server({
    port: opts.port,
    address: '127.0.0.1',
    quiet: true,
    // gc:false: forkDiffMerge/rebase/resurrection all need deleted items'
    // content still walkable (same reasoning as spike 5's relay.ts, ported
    // verbatim -- see that file's own comment on gcFilter).
    yDocOptions: { gc: false, gcFilter: () => false },
    extensions: [
      new SQLite({ database: dbPath }),
      {
        extensionName: 'phraise-relay',
        async onAuthenticate({ token, context }) {
          (context as Record<string, unknown>).user = token;
        },
        async onLoadDocument({ document, documentName }) {
          const parsed = parseDocName(documentName);
          if (!parsed) {
            console.error(`[relay] unrecognized document name (want "<branch>:g<generation>:<path>"): ${documentName}`);
            return;
          }
          const seeded = await seedOrRestore(document, { branch: parsed.branch, path: parsed.path, generation: parsed.generation, gitStore });
          if (seeded.kind === 'restored' || seeded.kind === 'seeded') {
            // Local state was actually absent (first-ever open, or this
            // relay process lost it): open the recovery window (forgery.ts
            // task 1) so a reconnecting client's first sync of THIS
            // document isn't rejected for carrying other users' structs
            // this fresh state doesn't yet know about.
            state.markRecoveryWindow(documentName, recoveryWindowMs);
          }
          attachIntegration(document, { isRemoteOrigin: isConnectionOrigin });
          state.register(parsed.branch, parsed.path, parsed.generation, document);
          poller.ensureBranch(parsed.branch);
        },
        async afterLoadDocument({ document }) {
          contentCache.set(document, contentKey(document));
        },
        async afterUnloadDocument({ documentName }) {
          const parsed = parseDocName(documentName);
          if (parsed) state.unregister(parsed.branch, parsed.path);
        },
        async beforeSync({ document, context, type, payload, connection }) {
          const user = (context as Record<string, unknown> | undefined)?.user as string | undefined;
          if (!user) return; // unauthenticated connections are refused earlier by Hocuspocus itself
          try {
            checkForgery(document, type, payload, user, {
              inRecoveryWindow: state.inRecoveryWindow(connection.document.name),
              onRelayedDuringRecovery: () => {
                state.counters.relayedDuringRecovery++;
              },
            });
          } catch (err) {
            if (err instanceof ForgedIdentityError) {
              state.counters.forgedRejections++;
              console.error(`[relay] rejected forged update on ${connection.document.name}: ${err.message}`);
            }
            throw err;
          }
        },
        async onChange({ document, update, context, transactionOrigin }) {
          if (!isConnectionOrigin(transactionOrigin)) return;
          const user = (context as Record<string, unknown> | undefined)?.user as string | undefined;
          if (!user) return;
          recordAttribution(document, update, user, Date.now());
          const key = contentKey(document);
          if (contentCache.get(document) !== key) {
            markEditor(document, user);
            contentCache.set(document, key);
          }
          contentCache.set(document, key);
          const parsed = parseDocName(document.name);
          if (parsed) debouncerFor(parsed.branch).touch();
        },
        async onRequest({ request, response, instance }) {
          await handleHttpRequest(instance, state, gitStore, poller, request, response);
        },
      },
    ],
  });

  await server.listen();

  return {
    port: opts.port,
    baseUrl: `http://127.0.0.1:${opts.port}`,
    wsUrl: `ws://127.0.0.1:${opts.port}`,
    state,
    async stop() {
      poller.stop();
      for (const d of debouncers.values()) d.stop();
      await server.destroy();
    },
  };
}

export { makeDocName, parseDocName, makeDocId };
export type { BranchState };
