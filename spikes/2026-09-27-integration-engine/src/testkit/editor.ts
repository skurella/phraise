// Brief 04 task 2: the live jsdom editor client, ported from spike 5
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, src/client.ts's `createLiveClient`) onto this spike's own
// `crdt.editorPlugins`/`crdt.initEditorDoc` (so this file never imports
// `yjs`/`@tiptap/y-tiptap` itself -- the import-boundary test scans every
// file outside `src/crdt/`, testkit included) and `engine.attachIntegration`
// (plan section 5: "every replica" runs integration, not just the relay).
//
// Deviations from spike 5's `client.ts`:
// - Plugin construction goes through `crdt.editorPlugins`/`initEditorDoc`
//   instead of building `[ySyncPlugin, leafMarksPlugin, rootAttrsPlugin]`
//   by hand (this file cannot touch `ySyncPlugin`/`Y.XmlFragment` directly).
// - `attachIntegration(ydoc, {isRemoteOrigin: (origin) => origin ===
//   provider})` is wired in: a Yjs transaction applying an incoming update
//   from the network is tagged with the `HocuspocusProvider` instance
//   itself as its origin (`@hocuspocus/provider`'s own
//   `readSyncMessage(..., provider)` call, confirmed by reading its
//   source), which is exactly "remote" from this replica's point of view;
//   the provider's own `documentUpdateHandler` uses the same `origin ===
//   this` test to decide which updates came from elsewhere versus this
//   replica's own local edits, so this mirrors an already-load-bearing
//   distinction rather than inventing a new one.
// - `disconnect()`/`connect()` (offline-period helpers, gate D/E-style)
//   delegate directly to the dedicated `websocketProvider` (per spike 5's
//   own finding: `HocuspocusProvider.connect()`/`disconnect()` are no-ops
//   whenever an explicit `websocketProvider` was supplied at construction,
//   which this file always does, for the `ws` polyfill jsdom needs).
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../markdown/index.js';
import { createDoc, editorPlugins, initEditorDoc, type CrdtDoc } from '../crdt/index.js';
import { attachIntegration } from '../engine/index.js';

export interface EditorOptions {
  /** ws://127.0.0.1:<port> */
  url: string;
  docName: string;
  /** The auth-stub token: this connection's user name (plan section 5/6). */
  token: string;
}

export interface LiveEditor {
  ydoc: CrdtDoc;
  provider: HocuspocusProvider;
  websocketProvider: HocuspocusProviderWebsocket;
  view: EditorView;
  waitForSynced(): Promise<void>;
  /** Simulates an offline period: tears down the websocket transport without destroying the editor or its Y.Doc. */
  disconnect(): void;
  /** Reconnects after `disconnect()`. Resolves once the reconnected sync completes. */
  connect(): Promise<void>;
  destroy(): void;
}

function waitForProviderSynced(provider: HocuspocusProvider): Promise<void> {
  if (provider.isSynced) return Promise.resolve();
  return new Promise((resolve) => {
    provider.on('synced', function handler() {
      provider.off('synced', handler);
      resolve();
    });
  });
}

/**
 * Async because the editor must not be built until the provider's initial
 * sync has actually delivered the relay's content (spike 5's own finding,
 * carried over verbatim): `initEditorDoc` reads the Y.XmlFragment
 * synchronously, and a freshly created Y.Doc has no content until the first
 * server round trip completes.
 */
export async function createLiveEditor(opts: EditorOptions): Promise<LiveEditor> {
  const ydoc = createDoc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: opts.url,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: opts.docName,
    document: ydoc,
    token: opts.token,
  });
  // An explicit `websocketProvider` leaves `manageSocket` false, so the
  // provider's own constructor skips its `attach()` call -- without this,
  // it never wires up listeners on the websocket transport at all (no
  // auth, no sync, `isSynced` stays false forever). Ported verbatim from
  // spike 5's `client.ts`.
  provider.attach();
  await waitForProviderSynced(provider);

  attachIntegration(ydoc, { isRemoteOrigin: (origin) => origin === provider });

  const { doc: initialDoc, mapping } = initEditorDoc(ydoc);
  const plugins = editorPlugins(ydoc, { mapping });
  const state = EditorState.create({ doc: initialDoc, schema, plugins });
  const view = new EditorView(document.createElement('div'), { state });

  return {
    ydoc,
    provider,
    websocketProvider,
    view,
    waitForSynced: () => waitForProviderSynced(provider),
    disconnect() {
      websocketProvider.disconnect();
    },
    async connect() {
      websocketProvider.connect();
      await waitForProviderSynced(provider);
    },
    destroy() {
      view.destroy();
      provider.destroy();
      websocketProvider.destroy();
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
