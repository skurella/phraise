// Live client, stack 14: a Y.Doc, a HocuspocusProvider over `ws`, and a
// real ProseMirror EditorView under jsdom with @y/prosemirror's
// `syncPlugin`/`configureYProsemirror` on the `prosemirror` shared type.
// No workaround plugins (unlike stack 13's client.ts) -- see src/yjs.ts's
// header for why none are needed.
//
// Specifier discipline (see src/relay.ts's header for the full story): the
// Y.Doc handed to HocuspocusProvider is constructed via the bare `yjs`
// specifier (the override target, `@y/y` under the hood) so it is the same
// physical copy Hocuspocus's own provider code uses internally. Only
// `@y/prosemirror`'s own functions (`syncPlugin`, `configureYProsemirror`)
// touch that Y.Doc's shared type thereafter.
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { syncPlugin, configureYProsemirror } from '@y/prosemirror';
import { schema } from './schema.js';
import { FRAGMENT_NAME } from './yjs.js';

export interface LiveClientOptions {
  /** ws://127.0.0.1:<port> */
  url: string;
  docName: string;
  token?: string;
}

export interface LiveClient {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  /**
   * The dedicated network transport for this client (gate G/E:
   * disconnect()/connect() on THIS, not on `provider` -- same note as stack
   * 13's client.ts: HocuspocusProvider.connect()/disconnect() are no-ops
   * whenever an explicit websocketProvider was supplied at construction,
   * which createLiveClient always does here (for the WebSocketPolyfill).
   */
  websocketProvider: HocuspocusProviderWebsocket;
  view: EditorView;
  waitForSynced(): Promise<void>;
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
 * Async for the same reason as stack 13's createLiveClient: the editor
 * must not be built/bound until the provider's initial sync has actually
 * delivered the relay's content, or `configureYProsemirror` would hydrate
 * the view from an empty shared type.
 */
export async function createLiveClient(opts: LiveClientOptions): Promise<LiveClient> {
  const ydoc = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: opts.url,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: opts.docName,
    document: ydoc as unknown as ConstructorParameters<typeof HocuspocusProvider>[0]['document'],
    token: opts.token ?? 'anonymous',
  });
  provider.attach();

  await waitForProviderSynced(provider);

  // Per the package README (and spike 2's binding probe): create the view
  // first (empty/default doc), then bind it to the shared type via
  // `configureYProsemirror`, which dispatches a transaction that hydrates
  // the view from Y synchronously.
  const state0 = EditorState.create({ schema, plugins: [syncPlugin()] });
  const view = new EditorView(document.createElement('div'), { state: state0 });
  const ytype = (ydoc as unknown as { get: (name: string) => any }).get(FRAGMENT_NAME);
  configureYProsemirror({ ytype })(view.state, view.dispatch);

  return {
    ydoc,
    provider,
    websocketProvider,
    view,
    waitForSynced: () => waitForProviderSynced(provider),
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
