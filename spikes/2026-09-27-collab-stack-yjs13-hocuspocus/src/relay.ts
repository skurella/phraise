#!/usr/bin/env npx tsx
// Stack 13 relay: a Hocuspocus 4.7 server with SQLite persistence.
//
// Run as a child process:
//   tsx src/relay.ts --port <n> --db <path> --seeds <dir>
//
// Bound to 127.0.0.1 only (charter constraint: ports 4210-4239, stack 13).
//
// Document naming convention for this spike:
//   file:<relpath>  -- if nothing is persisted yet, seed from
//                       <seeds>/<relpath> via spike 1's parse() and the
//                       codec in src/yjs.ts (root attrs into the
//                       phraise-doc Y.Map, leaf marks into the leafMarks
//                       node attr). This is the path gate C exercises.
//   plain:<relpath> -- same seed file, but written with plain
//                       prosemirrorToYXmlFragment and no codec: the
//                       negative control that must show the same loss
//                       spike 1's gate A3 measured (root attrs, atom marks).
//
// An HTTP GET /state/<docName> on the same port returns
// Y.encodeStateAsUpdate(document) as a raw binary body, so a gate can
// inspect exactly what the relay has stored for a document without going
// through a WebSocket client.
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import { parseMarkdown } from './parse.js';
import { docToYDoc, FRAGMENT_NAME, META_MAP_NAME } from './yjs.js';
import { recordAttribution, ATTRIBUTION_ORIGIN } from './attribution.js';

interface Args {
  port: number;
  db: string;
  seeds: string;
  /**
   * Hocuspocus defaults (found by reading @hocuspocus/server's
   * defaultConfiguration): debounce 2000ms, maxDebounce 10000ms -- the
   * onStoreDocument hook (the SQLite extension's write) is debounced per
   * document by this much after the last change, capped at maxDebounce so a
   * continuously-edited document still gets stored periodically. Gate G
   * overrides these to small values so its restart/kill scenarios don't
   * need multi-second real waits; production would keep the defaults (or
   * tune them for its own write-volume/durability trade-off).
   */
  debounce?: number;
  maxDebounce?: number;
  /** Gate E's size measurement only: skip every recordAttribution call, to isolate its byte cost by diffing against a normal run. */
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
    throw new Error('usage: relay.ts --port <n> --db <path> --seeds <dir> [--debounce <ms>] [--maxDebounce <ms>]');
  }
  return out as Args;
}

function splitDocName(documentName: string): { kind: 'file' | 'plain'; relpath: string } | null {
  if (documentName.startsWith('file:')) return { kind: 'file', relpath: documentName.slice('file:'.length) };
  if (documentName.startsWith('plain:')) return { kind: 'plain', relpath: documentName.slice('plain:'.length) };
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
        // Runs after SQLite's onLoadDocument (extension array order), so
        // `document.isEmpty(FRAGMENT_NAME)` reflects whatever SQLite just
        // restored (see @hocuspocus/extension-database's Database.onLoadDocument,
        // which applies the fetched update onto this same document
        // instance before this hook runs).
        async onLoadDocument({ document, documentName }) {
          if (process.env.PHRAISE_DEBUG_SEED) console.error('[relay debug] onLoadDocument', documentName, 'isEmpty=', document.isEmpty(FRAGMENT_NAME));
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
          if (process.env.PHRAISE_DEBUG_SEED) console.error('[relay debug] parsed doc.attrs=', doc.attrs);
          if (parsed.kind === 'file') {
            // Codec: root attrs into the phraise-doc Y.Map, leaf marks into
            // the leafMarks node attr -- docToYDoc writes directly into the
            // Document instance we were handed (it accepts an existing
            // Y.Doc as its second argument).
            docToYDoc(doc, document);
            if (process.env.PHRAISE_DEBUG_SEED) {
              console.error('[relay debug] right after docToYDoc, map.lead=', JSON.stringify(document.getMap(META_MAP_NAME).get('lead')));
            }
          } else {
            // Negative control: no codec at all.
            document.transact(() => {
              prosemirrorToYXmlFragment(doc, document.getXmlFragment(FRAGMENT_NAME));
            });
          }
          if (args.noAttribution) return;
          // Gate E: attribute the seed content to the 'seed' pseudo-user.
          // Can't rely on the onChange hook below for this one write:
          // @hocuspocus/server only calls `document.onUpdate(...)` (which
          // is what makes onChange fire) *after* onLoadDocument returns
          // (confirmed by reading loadDocument in its source: `document
          // .isLoading = false; document.onUpdate(...)` comes after the
          // `onLoadDocument` hooks call) -- so this transaction's own
          // 'update' event fires the Y.Doc's raw listener that already
          // exists (bound in Document's constructor) but never reaches
          // Hocuspocus's own onChange plumbing. Since the document was
          // empty before this hook ran, `encodeStateAsUpdate` at this point
          // is exactly the update this seed just produced.
          recordAttribution(document, Y.encodeStateAsUpdate(document), 'seed', Date.now());
        },
        async afterLoadDocument({ document, documentName }) {
          if (process.env.PHRAISE_DEBUG_SEED) {
            console.error('[relay debug] afterLoadDocument', documentName, 'map.lead=', JSON.stringify(document.getMap(META_MAP_NAME).get('lead')));
          }
        },
        async onAuthenticate({ token, context }) {
          // D5 / gate E: "record the Yjs client ID to user mapping at the
          // server's authentication hook from day one". The token IS the
          // user for this spike's harness (src/client.ts passes alice/bob/
          // etc as the token); onChange below reads context.user back out
          // per update.
          (context as Record<string, unknown>).user = token;
        },
        async onChange({ document, update, context, transactionOrigin }) {
          // Skip our own attribution writes (see attribution.ts's
          // ATTRIBUTION_ORIGIN doc comment for why this guard exists: every
          // document.transact() -- including the one recordAttribution
          // itself makes -- fires onChange again, since Hocuspocus's
          // onChange is bound to the Y.Doc's own 'update' event with no
          // filtering by source).
          if (args.noAttribution || transactionOrigin === ATTRIBUTION_ORIGIN) return;
          // `context.user` is set by onAuthenticate for every real client
          // connection. A server-internal transact with no connection
          // behind it (this relay's own seed write in onLoadDocument, which
          // runs before any client has connected) has no context.user --
          // gate E's listing surfaces that as the "seed" pseudo-user.
          const user = (context as Record<string, unknown> | undefined)?.user as string | undefined;
          recordAttribution(document, update, user ?? 'seed', Date.now());
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
          // The framework's requestHandler always writes its own 200
          // "Welcome to Hocuspocus!" response after every onRequest hook
          // resolves (see packages/server/src/Server.ts) unless the hook
          // throws -- and throwing here would surface as an unhandled
          // rejection (the http listener doesn't await requestHandler's
          // promise). Neutering the two calls it's about to make is the
          // one option that neither double-writes nor risks a crash.
          response.writeHead = (() => response) as any;
          response.end = (() => response) as any;
        },
      },
    ],
  });

  await server.listen();
  // Ready line the test harness waits for on stdout.
  console.log(`relay-ready port=${args.port} db=${dbPath} seeds=${seedsDir}`);

  // Gate G1 (graceful restart): SIGTERM flushes any debounced stores before
  // exiting, so "restart" doesn't depend on having waited out the debounce
  // window by luck. src/harness.ts's stop() sends SIGTERM first and only
  // escalates to SIGKILL after 2s, so this handler has time to run.
  // SIGKILL (gate G2) bypasses this entirely by design -- that's the point
  // of that scenario.
  process.on('SIGTERM', () => {
    // `flushPendingStores` lives on the inner `Hocuspocus` instance, not the
    // `Server` wrapper (see the onRequest hook above for the same
    // `(server as any).hocuspocus` reach-through, needed because
    // @hocuspocus/server's public `Server` type doesn't re-export it).
    (server as any).hocuspocus.flushPendingStores();
    setTimeout(() => process.exit(0), 100);
  });
}

main().catch((err) => {
  console.error('[relay] fatal', err);
  process.exit(1);
});
