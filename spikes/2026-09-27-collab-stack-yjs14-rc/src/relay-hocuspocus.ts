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
// Document naming convention for this spike: `file:<relpath>` (spike 1's
// schema/codec) and, added by brief 06 (gate F), `rebase:<name>` -- if
// nothing is persisted yet, seed from <seeds>/rebase/<name>.md via spike
// 2's own seedDoc/schema/markdown parser (src/rebase/), at commit "A"
// under REBASE_SEED_AUTHOR (below). Rebases against these documents run
// through the POST /rebase/<docName> route below. The brief is explicit
// that there is no `plain:` control here (stack 14 has no workaround to
// compare against for `file:`; there is nothing lossy to demonstrate).
// `file:` docs, if nothing is persisted yet, seed from <seeds>/<relpath>
// via spike 1's parse() and the codec in src/yjs.ts (pmnodeToDelta ->
// ytype.applyDelta).
//
// An HTTP GET /state/<docName> on the same port returns the relay's raw
// Yjs update for that document as a binary body, exactly as stack 13's
// relay does, so a gate can inspect what the relay has stored without a
// WebSocket client.
//
// An HTTP POST /rebase/<docName> (brief 06, gate F) runs spike 2's rebase
// directly on this relay's own in-memory document, exactly as stack 13's
// relay does (see that file's own top comment for the full design this
// mirrors): body is JSON `{ targetMarkdown, targetCommit, authorName?,
// authorEmail? }`. computeRebaseUpdate() forks `document` at its own base
// snapshot and returns an update *without* applying it; this handler
// applies it with Y.applyUpdate(document, update, REBASE_TX_ORIGIN) so
// Hocuspocus's normal update broadcasting takes over from there.
// Idempotence is checked at this route (read the document's current base
// pointer first, skip entirely if it already matches targetCommit) rather
// than inside computeRebaseUpdate, for the same reason stack 13's relay
// documents: a second call forking from an already-current base would
// still write new (self-referential, same-id) rebase-record/snapshot
// entries -- a needless rewrite of already-correct state, not a true no-op.
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
import { seedDoc, PHRAISE_MAP, PM_FRAGMENT as REBASE_PM_FRAGMENT, type Author } from './rebase/seed.js';
import { computeRebaseUpdate, type Base } from './rebase/rebase.js';
import { attachIntegrationHook, isConnectionOrigin } from './rebase/liveIntegration.js';

/** Origin tag for the /rebase route's own Y.applyUpdate call: not
 * shaped like @hocuspocus/server's ConnectionTransactionOrigin
 * ({source:'connection',...}), so isConnectionOrigin correctly does not
 * treat this as an incoming replica batch needing its own integrate() pass
 * (the relay computed this rebase itself; it is the new ground truth). */
const REBASE_TX_ORIGIN = 'rebase';

/** Fixed seed author for every `rebase:<name>` document's initial commit
 * "A" (brief 06's scope: one scenario, one seed identity; gate F supplies
 * its own MD_A/MD_B via the seed file and the /rebase route respectively). */
const REBASE_SEED_AUTHOR: Author = { name: 'Repo Owner', email: 'owner@example.com' };
const REBASE_SEED_COMMIT = 'A';

/** Documents this relay process has already attached the integration hook
 * to ("the relay itself also integrates (it is a replica)"). */
const integratedDocs = new WeakSet<object>();

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

function splitDocName(documentName: string): { kind: 'file' | 'rebase'; relpath: string } | null {
  if (documentName.startsWith('file:')) return { kind: 'file', relpath: documentName.slice('file:'.length) };
  if (documentName.startsWith('rebase:')) return { kind: 'rebase', relpath: documentName.slice('rebase:'.length) };
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
    // Brief 06 design constraint (same as stack 13's relay.ts): "documents
    // are gc:false on the relay and on every client" -- integrate()'s
    // resurrection (src/rebase/integrate.ts) needs deleted items' content
    // to still be walkable, which Yjs's garbage collector would otherwise
    // reclaim. Applies to every doc kind on this relay (file: docs too);
    // no existing gate (A/B/C/B3/D/E/G) depends on GC being on -- checked
    // before relying on that, none of them reference `gc`/`gcFilter` at all.
    yDocOptions: { gc: false, gcFilter: () => false },
    ...(args.debounce !== undefined ? { debounce: args.debounce } : {}),
    ...(args.maxDebounce !== undefined ? { maxDebounce: args.maxDebounce } : {}),
    extensions: [
      new SQLite({ database: dbPath }),
      {
        extensionName: 'phraise-seed',
        // Runs after SQLite's onLoadDocument (extension array order), same
        // as stack 13's relay.
        async onLoadDocument({ document, documentName }) {
          const parsed = splitDocName(documentName);

          // Brief 06: attach the relay-side integration hook once per
          // document, regardless of kind -- "the relay itself also
          // integrates (it is a replica)". Attached before any seeding
          // below runs, same ordering as stack 13's relay.
          if (!integratedDocs.has(document)) {
            integratedDocs.add(document);
            attachIntegrationHook(document as unknown as Y.Doc, { isRemoteOrigin: isConnectionOrigin });
          }

          // rebase: docs use spike 2's own "pm" fragment (src/rebase/seed.ts's
          // PM_FRAGMENT), not spike 1's FRAGMENT_NAME ("prosemirror") -- the
          // two schemas/codecs never share a document.
          if (parsed?.kind === 'rebase') {
            if (!document.isEmpty(REBASE_PM_FRAGMENT)) return;
            const seedPath = path.join(seedsDir, 'rebase', `${parsed.relpath}.md`);
            if (!fs.existsSync(seedPath)) {
              console.error(`[relay] rebase seed missing for ${documentName}: ${seedPath}`);
              return;
            }
            const md = fs.readFileSync(seedPath, 'utf8');
            // seedDoc builds its own fresh Y.Doc (deterministic seed peer,
            // gc:false); merge its content into the Document instance we
            // were actually handed (Hocuspocus owns this `document` object).
            const seeded = seedDoc(parsed.relpath, md, REBASE_SEED_COMMIT, REBASE_SEED_AUTHOR);
            Y.applyUpdate(document as unknown as Y.Doc, Y.encodeStateAsUpdate(seeded), REBASE_TX_ORIGIN);
            return;
          }

          if (!document.isEmpty(FRAGMENT_NAME)) return;
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
          function sendJSON(status: number, body: unknown): void {
            response.writeHead(status, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(body));
            // See below for why the framework's own response writes must
            // be neutered here rather than throwing.
            response.writeHead = (() => response) as any;
            response.end = (() => response) as any;
          }

          const url = request.url ?? '';

          // Brief 06, gate F: POST /rebase/<docName> {targetMarkdown,
          // targetCommit, authorName?, authorEmail?} runs spike 2's rebase
          // on this relay's own in-memory document (see this file's
          // top-of-file comment for the full design).
          const rebasePrefix = '/rebase/';
          if (request.method === 'POST' && url.startsWith(rebasePrefix)) {
            const documentName = decodeURIComponent(url.slice(rebasePrefix.length));
            const instance = (server as any).hocuspocus;
            const document = instance.documents.get(documentName);
            if (!document) {
              sendJSON(404, { error: `document not loaded (no client has connected yet): ${documentName}` });
              return;
            }
            let bodyText = '';
            for await (const chunk of request) bodyText += chunk;
            let req: { targetMarkdown: string; targetCommit: string; authorName?: string; authorEmail?: string };
            try {
              req = JSON.parse(bodyText);
            } catch {
              sendJSON(400, { error: 'invalid JSON body' });
              return;
            }
            const parsedName = splitDocName(documentName);
            const docId = parsedName?.relpath ?? documentName;
            const phraise = document.get(PHRAISE_MAP);
            const currentBase = phraise.getAttr('base') as Base | undefined;
            if (currentBase && currentBase.commit === req.targetCommit) {
              // Idempotence: already at the requested target, no-op.
              sendJSON(200, { applied: false, reason: 'already at target', rebaseId: currentBase.id });
              return;
            }
            try {
              const { update, rebaseId } = computeRebaseUpdate(document as unknown as Y.Doc, {
                docId,
                targetMarkdown: req.targetMarkdown,
                targetCommit: req.targetCommit,
                author: { name: req.authorName ?? 'Contributor Two', email: req.authorEmail ?? 'c2@example.com' },
              });
              Y.applyUpdate(document as unknown as Y.Doc, update, REBASE_TX_ORIGIN);
              // Immediately ack this record under the relay's OWN clientID,
              // synchronously, right after applying the rebase -- same
              // relay-ack fix stack 13's relay.ts documents in full (its
              // own top comment): without this, the relay's own
              // attachIntegrationHook would run integrate() for this
              // record under the relay's clientID on whatever LATER
              // connection-sourced transaction happens to arrive next, by
              // which point the relay's live document has already moved
              // past the rebase, so the snapshot P taken just before that
              // later transaction no longer reflects "before this rebase"
              // -- every upstream-changed block would then look "locally
              // changed" too and get flagged concurrent-edit, a false
              // positive. The relay itself never has a genuine "local
              // edit" to compare against (its writes are tagged with the
              // seed/rebase peers' own deterministic clientIDs, never the
              // Document's), so acking immediately is simply correct.
              document.transact(() => {
                phraise.setAttr(`ack:${rebaseId}:${document.clientID}`, true);
              }, REBASE_TX_ORIGIN);
              sendJSON(200, { applied: true, rebaseId });
            } catch (err) {
              sendJSON(500, { error: err instanceof Error ? err.message : String(err) });
            }
            return;
          }

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
