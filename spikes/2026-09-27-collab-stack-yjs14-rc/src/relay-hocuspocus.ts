#!/usr/bin/env npx tsx
// Stack 14 relay, brief 04: Hocuspocus 4.7 server and SQLite persistence --
// now the PRIMARY relay (see README "Relay decision" and the log for the
// full story of why brief 02's attempt (a) crashed and what fixed it).
//
// npm `overrides` aliases `yjs` -> `npm:@y/y@14.0.0-rc.26`, `y-protocols` ->
// `npm:@y/protocols@1.0.6-rc.1`, and `lib0` -> `$lib0` (package.json), but
// that alone is NOT enough (brief 02 confirmed this the hard way): an
// `npm:`-aliased package installs under the OVERRIDDEN name's own directory,
// physically separate on disk from the real scoped package even though the
// content is identical, so Yjs's own "already imported" guard still fires
// and two incompatible `lib0` majors (Hocuspocus's own `^0.2.117` nested
// copy vs `@y/y`'s `^1.0.0-rc.29`) coexist in one process, crashing the sync
// handshake with `RangeError: Maximum call stack size exceeded` in
// `lib0/encoding.js`'s `writeAny` the moment a real client connects.
//
// The fix (this brief): `scripts/postinstall-dedupe.mjs`, run as this
// package's own `postinstall`, replaces `node_modules/yjs` and
// `node_modules/y-protocols` with SYMLINKS to `node_modules/@y/y` and
// `node_modules/@y/protocols` after every install, so there is exactly ONE
// copy of each package on disk and Node's module resolution hands out the
// exact same instance either way -- confirmed directly:
// `(await import('yjs')).Doc === (await import('@y/y')).Doc` is now true,
// only one `lib0` directory exists anywhere under `node_modules` (verified
// with `find node_modules -name lib0`), and a real client
// (src/client-hocuspocus.ts) can connect, sync, and edit without crashing
// (scratch/tmp-hp-dedupe-test.ts, run before this file's onAuthenticate/
// attribution/debounce additions below, then removed once the finding was
// logged).
//
// Run as a child process:
//   tsx src/relay-hocuspocus.ts --port <n> --db <path> --seeds <dir> [--debounce <ms>] [--maxDebounce <ms>] [--no-attribution]
//
// Bound to 127.0.0.1 only (charter constraint: ports 4240-4269, stack 14).
//
// Document naming convention for this spike: `file:<relpath>` only -- the
// brief is explicit that there is no `plain:` control here (stack 14 has no
// workaround to compare against; there is nothing lossy to demonstrate).
// If nothing is persisted yet, seed from <seeds>/<relpath> via spike 1's
// parse() and the codec in src/yjs.ts (pmnodeToDelta -> ytype.applyDelta).
//
// An HTTP GET /state/<docName> on the same port returns the relay's raw
// Yjs update for that document as a binary body, exactly as stack 13's
// relay does, so a gate can inspect what the relay has stored without a
// WebSocket client.
//
// Specifier discipline (still needed even with the symlinks in place, for
// documentation/clarity -- see src/client-hocuspocus.ts's header too):
// everything here imports Yjs functionality via the bare `yjs` specifier
// (never `@y/y` directly), because `@hocuspocus/server`'s own `Document`
// class extends the `Doc` it imports from `yjs`.
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import { pmnodeToDelta } from '@y/prosemirror';
import { parseMarkdown } from './parse.js';
import { FRAGMENT_NAME } from './yjs.js';
import { recordAttribution, ATTRIBUTION_ORIGIN } from './attribution.js';

interface Args {
  port: number;
  db: string;
  seeds: string;
  /** Gate G: shorten Hocuspocus's onStoreDocument debounce (default 2000ms/10000ms) so restart/kill scenarios don't need multi-second real waits. */
  debounce?: number;
  maxDebounce?: number;
  /** Gate E's size measurement only: skip every recordAttribution call. */
  noAttribution?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--seeds') out.seeds = argv[++i];
    else if (a === '--debounce') out.debounce = Number(argv[++i]);
    else if (a === '--maxDebounce') out.maxDebounce = Number(argv[++i]);
    else if (a === '--no-attribution') out.noAttribution = true;
  }
  if (!out.port || !out.db || !out.seeds) {
    throw new Error('usage: relay-hocuspocus.ts --port <n> --db <path> --seeds <dir> [--debounce <ms>] [--maxDebounce <ms>] [--no-attribution]');
  }
  return out as Args;
}

function splitDocName(documentName: string): { relpath: string } | null {
  if (documentName.startsWith('file:')) return { relpath: documentName.slice('file:'.length) };
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedsDir = path.resolve(args.seeds);
  const dbPath = path.resolve(args.db);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const server = new Server({
    port: args.port,
    address: '127.0.0.1',
    quiet: true,
    ...(args.debounce !== undefined ? { debounce: args.debounce } : {}),
    ...(args.maxDebounce !== undefined ? { maxDebounce: args.maxDebounce } : {}),
    extensions: [
      new SQLite({ database: dbPath }),
      {
        extensionName: 'phraise-seed',
        // Runs after SQLite's onLoadDocument (extension array order), same
        // as stack 13's relay.
        async onLoadDocument({ document, documentName }) {
          if (!document.isEmpty(FRAGMENT_NAME)) return;
          const parsed = splitDocName(documentName);
          if (!parsed) return;
          const seedPath = path.join(seedsDir, parsed.relpath);
          if (!fs.existsSync(seedPath)) {
            console.error(`[relay] seed missing for ${documentName}: ${seedPath}`);
            return;
          }
          const md = fs.readFileSync(seedPath, 'utf8');
          const { doc } = parseMarkdown(md);
          // Seed directly into the Document instance Hocuspocus handed us
          // (a `yjs`-specifier Y.Doc): get its shared type, apply the
          // pmnodeToDelta-encoded content. @y/prosemirror's functions only
          // touch the shared-type object (not the Y.Doc class), so this
          // works regardless of which physical copy constructed `document`.
          const ytype = (document as unknown as { get: (name: string) => any }).get(FRAGMENT_NAME);
          document.transact(() => {
            ytype.applyDelta(pmnodeToDelta(doc));
          });
          if (args.noAttribution) return;
          // Gate E: attribute the seed content to the 'seed' pseudo-user.
          // Same reasoning as stack 13's relay.ts: onLoadDocument runs
          // before Hocuspocus wires up the document's own onUpdate ->
          // onChange plumbing (document.isLoading is still true), so this
          // write never reaches the onChange hook below on its own; since
          // the document was empty before this hook ran,
          // encodeStateAsUpdate at this point is exactly the update this
          // seed just produced.
          recordAttribution(document as unknown as Y.Doc, Y.encodeStateAsUpdate(document), 'seed', Date.now());
        },
        async onAuthenticate({ token, context }) {
          // D5 / gate E: record the Yjs client ID -> user mapping at the
          // server's authentication hook, from day one. The token IS the
          // user for this spike's harness (src/client-hocuspocus.ts passes
          // alice/bob/etc as the token); onChange below reads
          // context.user back out per update.
          (context as Record<string, unknown>).user = token;
        },
        async onChange({ document, update, context, transactionOrigin }) {
          // Skip our own attribution writes -- see attribution.ts's
          // ATTRIBUTION_ORIGIN doc comment: every document.transact() call
          // (including recordAttribution's own) fires onChange again, since
          // Hocuspocus's onChange is bound to the Y.Doc's own 'update'
          // event with no filtering by source.
          if (args.noAttribution || transactionOrigin === ATTRIBUTION_ORIGIN) return;
          const user = (context as Record<string, unknown> | undefined)?.user as string | undefined;
          recordAttribution(document as unknown as Y.Doc, update, user ?? 'seed', Date.now());
        },
        async onRequest({ request, response }) {
          const url = request.url ?? '';
          const prefix = '/state/';
          if (!url.startsWith(prefix)) return;
          const documentName = decodeURIComponent(url.slice(prefix.length));
          const instance = (server as any).hocuspocus;
          const document = instance.documents.get(documentName);
          const update = document ? Y.encodeStateAsUpdate(document) : new Uint8Array();
          response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          response.end(Buffer.from(update));
          // See stack 13's relay.ts for why the framework's own response
          // writes must be neutered here rather than throwing.
          response.writeHead = (() => response) as any;
          response.end = (() => response) as any;
        },
      },
    ],
  });

  await server.listen();
  console.log(`relay-ready port=${args.port} db=${dbPath} seeds=${seedsDir}`);

  // Gate G1 (graceful restart): SIGTERM flushes any debounced stores before
  // exiting -- same mechanism as stack 13's relay.ts. src/harness.ts's
  // stop() sends SIGTERM first and only escalates to SIGKILL after 2s, so
  // this handler has time to run. SIGKILL (gate G2) bypasses this by design.
  process.on('SIGTERM', () => {
    (server as any).hocuspocus.flushPendingStores();
    setTimeout(() => process.exit(0), 100);
  });
}

main().catch((err) => {
  console.error('[relay] fatal', err);
  process.exit(1);
});
