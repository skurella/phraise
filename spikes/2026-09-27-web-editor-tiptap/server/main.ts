#!/usr/bin/env npx tsx
// Spike 7, brief 01: one Node process holding the Hocuspocus 4.7 relay
// (SQLite persistence, gc:false, attribution hook) and a static HTTP server
// for the Vite-built page (`dist/`). Both bind 127.0.0.1 only.
//
// Trimmed from spike 5's src/relay.ts (see README's origin section): only
// the `file:<relpath>` document kind is seeded (spike 5's `plain:` negative
// control and `rebase:` kind, and its POST /rebase route, are spike 5/2
// concerns this foundation brief has no use for). The attribution hook
// (onAuthenticate/onChange -> src/model/attribution.ts) is kept unchanged.
//
// Usage:
//   tsx server/main.ts --port <n> --db <path> --seeds <dir> [--relay-port <n>]
//
// Document naming: `file:<relpath>`, seeded once (if the document is empty)
// from `<seeds>/<relpath>` through src/model/parse.ts + src/model/yjs.ts's
// codec (root attrs into the phraise-doc Y.Map, leaf marks into the
// leafMarks node attr).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import { parseMarkdown } from '../src/model/parse.js';
import { docToYDoc, FRAGMENT_NAME } from '../src/model/yjs.js';
import { recordAttribution, ATTRIBUTION_ORIGIN } from '../src/model/attribution.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = path.resolve(HERE, '..');

interface Args {
  port: number;
  relayPort: number;
  db: string;
  seeds: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--relay-port') out.relayPort = Number(argv[++i]);
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--seeds') out.seeds = argv[++i];
  }
  if (!out.port || !out.db || !out.seeds) {
    throw new Error('usage: main.ts --port <n> --db <path> --seeds <dir> [--relay-port <n>]');
  }
  if (!out.relayPort) out.relayPort = out.port + 1;
  return out as Args;
}

function splitDocName(documentName: string): { relpath: string } | null {
  if (!documentName.startsWith('file:')) return null;
  return { relpath: documentName.slice('file:'.length) };
}

/** List every `.md` file under `dir`, recursively, as relpaths (posix-style, sorted). */
function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  function walk(sub: string) {
    const abs = sub ? path.join(dir, sub) : dir;
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.md')) out.push(rel);
    }
  }
  walk('');
  return out.sort();
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedsDir = path.resolve(args.seeds);
  const dbPath = path.resolve(args.db);
  const distDir = path.join(SPIKE_ROOT, 'dist');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const relay = new HocuspocusServer({
    port: args.relayPort,
    address: '127.0.0.1',
    quiet: true,
    // D5 / brief 05 constraint, kept: documents are gc:false so resurrection
    // and attribution ranges stay walkable. See spike 5's src/relay.ts.
    yDocOptions: { gc: false, gcFilter: () => false },
    extensions: [
      new SQLite({ database: dbPath }),
      {
        extensionName: 'phraise-seed',
        async onLoadDocument({ document, documentName }) {
          const parsed = splitDocName(documentName);
          if (!parsed) return;
          if (!document.isEmpty(FRAGMENT_NAME)) return;
          const seedPath = path.join(seedsDir, parsed.relpath);
          if (!fs.existsSync(seedPath)) {
            console.error(`[server] seed missing for ${documentName}: ${seedPath}`);
            return;
          }
          const md = fs.readFileSync(seedPath, 'utf8');
          const { doc } = parseMarkdown(md);
          docToYDoc(doc, document);
          recordAttribution(document, Y.encodeStateAsUpdate(document), 'seed', Date.now());
        },
        async onAuthenticate({ token, context }) {
          // D5: record the Yjs client ID to user mapping from the
          // authentication hook. The token IS the user name here (the page
          // passes `?user=<name>` through as the provider token).
          (context as Record<string, unknown>).user = token;
        },
        async onChange({ document, update, context, transactionOrigin }) {
          if (transactionOrigin === ATTRIBUTION_ORIGIN) return;
          const user = (context as Record<string, unknown> | undefined)?.user as string | undefined;
          recordAttribution(document, update, user ?? 'seed', Date.now());
        },
      },
    ],
  });

  await relay.listen();

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/api/files') {
      const files = listMarkdownFiles(seedsDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(files));
      return;
    }

    if (url.pathname === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ relayUrl: `ws://127.0.0.1:${args.relayPort}` }));
      return;
    }

    // Static file server for dist/. The page's own routing is entirely in
    // the query string (?doc=&user=), so any non-file path falls back to
    // index.html.
    const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const resolved = path.normalize(path.join(distDir, reqPath));
    let filePath = resolved;
    if (!resolved.startsWith(distDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found. did you run `npm run build`?');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  }

  const staticServer = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[server] request error', err);
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error');
    });
  });

  await new Promise<void>((resolve) => staticServer.listen(args.port, '127.0.0.1', () => resolve()));

  // Ready line the test/start harnesses wait for on stdout.
  console.log(`server-ready port=${args.port} relay-port=${args.relayPort} db=${dbPath} seeds=${seedsDir}`);

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await new Promise<void>((resolve) => staticServer.close(() => resolve()));
    await relay.destroy();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[server] fatal', err);
  process.exit(1);
});
