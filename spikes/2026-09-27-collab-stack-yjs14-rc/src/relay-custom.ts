#!/usr/bin/env npx tsx
// Stack 14 relay, attempt (b): a minimal custom relay on `ws` and
// `@y/protocols` (sync + awareness), used because attempt (a) --
// Hocuspocus 4.7 with npm `overrides` aliasing `yjs`/`y-protocols` to
// `@y/y`/`@y/protocols` -- crashes on the first real client handshake with
// a `RangeError: Maximum call stack size exceeded` in `lib0/encoding.js`'s
// `writeAny` (see `src/relay-attempt-a-hocuspocus.ts`'s header and the log
// for the full diagnosis: two incompatible major versions of `lib0`
// -- `0.2.118` used by Hocuspocus's own code, `1.0.0-rc.33` nested under
// both the aliased `yjs` and `@y/prosemirror` -- coexist in one process).
//
// This relay speaks the same wire protocol as the reference `y-websocket`
// server (`bin/utils.js`'s `setupWSConnection`, which this spike does not
// depend on -- only `@y/protocols`' pure encode/decode functions are used):
// a message is `[messageType: varUint, ...]`, `messageType` 0 = sync
// (`@y/protocols/sync`'s step1/step2/update), 1 = awareness
// (`@y/protocols/awareness`). Both sides send their own sync step 1
// immediately on connect (symmetric handshake, matching the reference
// implementation); each side replies to the other's step 1 with its own
// step 2 (the diff), and update events after that are broadcast to every
// other connection on the same document.
//
// Run as a child process:
//   tsx src/relay.ts --port <n> --db <dir> --seeds <dir>
//
// Bound to 127.0.0.1 only (charter constraint: ports 4240-4269, stack 14).
// `--db` is a **directory** here (unlike stack 13's single SQLite file):
// persistence is one file per document, `<db>/<encodeURIComponent(docName)>.yupdate`,
// holding `Y.encodeStateAsUpdate(ydoc)` for that document, rewritten after
// every applied update. `--seeds` + `file:<relpath>` seeding, and the
// `GET /state/<docName>` route, work exactly as stack 13's and stack 14's
// attempt-(a) relay: the same doc-naming convention, no `plain:` control.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from '@y/y';
import * as syncProtocol from '@y/protocols/sync';
import * as awarenessProtocol from '@y/protocols/awareness';
import { pmnodeToDelta } from '@y/prosemirror';
import { parseMarkdown } from './parse.js';
import { FRAGMENT_NAME } from './yjs.js';

const messageSync = 0;
const messageAwareness = 1;

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
    throw new Error('usage: relay.ts --port <n> --db <dir> --seeds <dir>');
  }
  return out as Args;
}

interface Room {
  docName: string;
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>; // ws -> the awareness clientIDs it introduced
}

function persistPath(dbDir: string, docName: string): string {
  return path.join(dbDir, `${encodeURIComponent(docName)}.yupdate`);
}

/**
 * Send `encoder`'s bytes, unless all it holds is the outer message-type
 * wrapper byte with no payload after it. `readSyncMessage` only ever
 * writes a reply for an incoming sync step 1 (the reply being step 2); for
 * step 2 or update messages it applies the change locally and writes
 * nothing back. Since the caller always writes the one-byte `messageSync`
 * wrapper into `encoder` *before* calling `readSyncMessage` (so the reply,
 * if any, comes pre-tagged), a length of exactly 1 means "no reply" -- if
 * this sent anyway, the peer would try to read a second (inner) message
 * type from an already-exhausted decoder and throw `Unexpected end of
 * array` (found the hard way: both this relay and src/client.ts crashed on
 * exactly this 1-byte message before this guard was tightened from `<= 0`
 * to `<= 1`).
 */
function send(ws: WebSocket, encoder: encoding.Encoder): void {
  if (encoding.length(encoder) <= 1) return;
  if (ws.readyState !== ws.OPEN) return;
  ws.send(encoding.toUint8Array(encoder));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedsDir = path.resolve(args.seeds);
  const dbDir = path.resolve(args.db);
  fs.mkdirSync(dbDir, { recursive: true });

  const rooms = new Map<string, Room>();
  const connUsers = new WeakMap<WebSocket, string>();

  function loadOrSeed(ydoc: Y.Doc, docName: string): void {
    const file = persistPath(dbDir, docName);
    if (fs.existsSync(file)) {
      const update = new Uint8Array(fs.readFileSync(file));
      if (update.length > 0) Y.applyUpdate(ydoc, update);
      return;
    }
    if (!docName.startsWith('file:')) return;
    const relpath = docName.slice('file:'.length);
    const seedPath = path.join(seedsDir, relpath);
    if (!fs.existsSync(seedPath)) {
      console.error(`[relay] seed missing for ${docName}: ${seedPath}`);
      return;
    }
    const md = fs.readFileSync(seedPath, 'utf8');
    const { doc } = parseMarkdown(md);
    const ytype = ydoc.get(FRAGMENT_NAME);
    ydoc.transact(() => {
      ytype.applyDelta(pmnodeToDelta(doc));
    });
  }

  function persist(docName: string, ydoc: Y.Doc): void {
    const update = Y.encodeStateAsUpdate(ydoc);
    fs.writeFileSync(persistPath(dbDir, docName), Buffer.from(update));
  }

  function getRoom(docName: string): Room {
    let room = rooms.get(docName);
    if (room) return room;
    const ydoc = new Y.Doc();
    loadOrSeed(ydoc, docName);
    const awareness = new awarenessProtocol.Awareness(ydoc);
    room = { docName, ydoc, awareness, conns: new Map() };
    rooms.set(docName, room);

    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      persist(docName, ydoc);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      for (const conn of room!.conns.keys()) {
        if (conn === origin) continue;
        send(conn, encoder);
      }
    });

    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changedClients = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
      for (const conn of room!.conns.keys()) {
        if (conn === origin) continue;
        send(conn, encoder);
      }
    });

    return room;
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const prefix = '/state/';
    if (url.startsWith(prefix)) {
      const documentName = decodeURIComponent(url.slice(prefix.length));
      const room = rooms.get(documentName);
      const update = room ? Y.encodeStateAsUpdate(room.ydoc) : new Uint8Array();
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(update));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const docName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const token = url.searchParams.get('token') ?? 'anonymous';
    connUsers.set(ws, token);

    const room = getRoom(docName);
    room.conns.set(ws, new Set());

    ws.binaryType = 'arraybuffer';
    ws.on('message', (data: ArrayBuffer | Buffer) => {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === messageSync) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, room.ydoc, ws);
        send(ws, encoder);
      } else if (messageType === messageAwareness) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        // Track which clientIDs this connection introduced, so we can
        // clear them on disconnect. No public helper extracts just the
        // ids from an encoded update, so decode it ourselves (same wire
        // format as encodeAwarenessUpdate).
        const idsDecoder = decoding.createDecoder(update);
        const len = decoding.readVarUint(idsDecoder);
        const known = room.conns.get(ws)!;
        for (let i = 0; i < len; i++) {
          const clientID = decoding.readVarUint(idsDecoder);
          decoding.readVarUint(idsDecoder); // clock
          decoding.readVarString(idsDecoder); // state json
          known.add(clientID);
        }
      }
    });

    const closeOrError = () => {
      const known = room.conns.get(ws);
      room.conns.delete(ws);
      if (known && known.size > 0) {
        awarenessProtocol.removeAwarenessStates(room.awareness, [...known], ws);
      }
    };
    ws.on('close', closeOrError);
    ws.on('error', closeOrError);

    // Symmetric handshake: send our own sync step 1 right away.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, room.ydoc);
    send(ws, encoder);

    if (room.awareness.getStates().size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]),
      );
      send(ws, awEncoder);
    }
  });

  await new Promise<void>((resolve) => server.listen(args.port, '127.0.0.1', resolve));
  console.log(`relay-ready port=${args.port} db=${dbDir} seeds=${seedsDir}`);
}

main().catch((err) => {
  console.error('[relay] fatal', err);
  process.exit(1);
});
