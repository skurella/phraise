// Live client, stack 14: a `@y/y` `Y.Doc`, a small hand-rolled provider
// over `ws` speaking the same wire protocol as src/relay.ts (attempt (b):
// see that file's header for why this spike does not use Hocuspocus), and
// a real ProseMirror EditorView under jsdom bound with `@y/prosemirror`'s
// `syncPlugin`/`configureYProsemirror`. No workaround plugins -- see
// src/yjs.ts's header for why none are needed.
//
// The brief allows either `@y/websocket` or "a small provider of your
// own" on the client side; a small provider was chosen here so the exact
// same handshake logic (and the same `syncProtocol`/`awarenessProtocol`
// imports) is shared, line for line, with the relay -- one less place for
// the two sides to drift apart while this is still an RC-versioned stack.
import WebSocket from 'ws';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from '@y/y';
import * as syncProtocol from '@y/protocols/sync';
import * as awarenessProtocol from '@y/protocols/awareness';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { syncPlugin, configureYProsemirror } from '@y/prosemirror';
import { schema } from './schema.js';
import { FRAGMENT_NAME } from './yjs.js';

const messageSync = 0;
const messageAwareness = 1;

export interface LiveClientOptions {
  /** ws://127.0.0.1:<port> */
  url: string;
  docName: string;
  token?: string;
}

export interface LiveClient {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  ws: WebSocket;
  view: EditorView;
  waitForSynced(): Promise<void>;
  destroy(): void;
}

export async function createLiveClient(opts: LiveClientOptions): Promise<LiveClient> {
  const ydoc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(ydoc);
  const wsUrl = `${opts.url}/${encodeURIComponent(opts.docName)}?token=${encodeURIComponent(opts.token ?? 'anonymous')}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  let resolveSynced: () => void;
  let synced = false;
  const syncedPromise = new Promise<void>((resolve) => {
    resolveSynced = () => {
      synced = true;
      resolve();
    };
  });

  // See src/relay.ts's `send()` for why the threshold is 1, not 0: the
  // caller always writes the one-byte `messageSync` wrapper before calling
  // `readSyncMessage`, so a length of exactly 1 means "no reply to send"
  // (step 2 / update messages don't get one) -- sending it anyway crashes
  // the peer's decoder trying to read a second message type that isn't
  // there (found the hard way, see the relay's comment for the trace).
  function send(encoder: encoding.Encoder): void {
    if (encoding.length(encoder) <= 1) return;
    if (ws.readyState !== ws.OPEN) return;
    ws.send(encoding.toUint8Array(encoder));
  }

  ws.on('message', (data: ArrayBuffer | Buffer) => {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const decoder = decoding.createDecoder(buf);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      const readType = syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
      send(encoder);
      if (readType === syncProtocol.messageYjsSyncStep2 && !synced) resolveSynced();
    } else if (messageType === messageAwareness) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);
    }
  });

  ws.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    send(encoder);
  });

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === ws) return; // came from the relay; don't echo back
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    send(encoder);
  });

  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === ws) return;
    const changed = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    send(encoder);
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', function onOpen() {
      ws.off('open', onOpen);
      resolve();
    });
    ws.on('error', reject);
  });
  await syncedPromise;

  const state0 = EditorState.create({ schema, plugins: [syncPlugin()] });
  const view = new EditorView(document.createElement('div'), { state: state0 });
  const ytype = ydoc.get(FRAGMENT_NAME);
  configureYProsemirror({ ytype })(view.state, view.dispatch);

  return {
    ydoc,
    awareness,
    ws,
    view,
    waitForSynced: () => syncedPromise,
    destroy() {
      view.destroy();
      awareness.destroy();
      ws.close();
    },
  };
}

/** Poll until `check()` returns true, or throw after `timeoutMs`. */
export async function waitUntil(check: () => boolean, timeoutMs = 5000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
