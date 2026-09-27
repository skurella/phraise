#!/usr/bin/env npx tsx
// Stack 14 relay, attempt (a): Hocuspocus 4.7 server and SQLite
// persistence, with npm `overrides` aliasing `yjs` -> `npm:@y/y@14.0.0-rc.26`
// and `y-protocols` -> `npm:@y/protocols@1.0.6-rc.1` (see package.json).
//
// Run as a child process:
//   tsx src/relay.ts --port <n> --db <path> --seeds <dir>
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
// IMPORTANT: everything in this file imports Yjs functionality via the bare
// `yjs` specifier (never `@y/y` directly), because `@hocuspocus/server`'s
// own `Document` class extends the `Doc` it imports from `yjs` -- which,
// under the override, resolves to a *physically separate* copy of the
// @y/y package installed under node_modules/yjs (confirmed: `yjs` and
// `@y/y` are two distinct directories with identical content, not a
// symlink -- `npm:` aliasing does not dedupe against the real name). Yjs's
// own cross-import guard prints "Yjs was already imported. This breaks
// constructor checks..." the moment both specifiers are loaded in one
// process (confirmed with a standalone probe script); staying on the
// `yjs` specifier everywhere in *this* file keeps every Y.Doc instance
// Hocuspocus hands us on the one copy Hocuspocus itself uses.
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import { pmnodeToDelta } from '@y/prosemirror';
import { parseMarkdown } from './parse.js';
import { FRAGMENT_NAME } from './yjs.js';

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
        },
        async onAuthenticate({ token, context }) {
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
}

main().catch((err) => {
  console.error('[relay] fatal', err);
  process.exit(1);
});
