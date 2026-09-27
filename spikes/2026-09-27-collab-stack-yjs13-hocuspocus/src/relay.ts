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

interface Args {
  port: number;
  db: string;
  seeds: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--seeds') out.seeds = argv[++i];
  }
  if (!out.port || !out.db || !out.seeds) {
    throw new Error('usage: relay.ts --port <n> --db <path> --seeds <dir>');
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
        },
        async afterLoadDocument({ document, documentName }) {
          if (process.env.PHRAISE_DEBUG_SEED) {
            console.error('[relay debug] afterLoadDocument', documentName, 'map.lead=', JSON.stringify(document.getMap(META_MAP_NAME).get('lead')));
          }
        },
        async onAuthenticate({ token, context }) {
          // Brief 03 builds attribution on this; for now just record who connected.
          (context as Record<string, unknown>).user = token;
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
}

main().catch((err) => {
  console.error('[relay] fatal', err);
  process.exit(1);
});
