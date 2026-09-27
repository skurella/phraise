// Live client: a Y.Doc, a HocuspocusProvider over `ws`, and a real
// ProseMirror EditorView under jsdom with ySyncPlugin from @tiptap/y-tiptap
// on the `prosemirror` fragment, plus (optionally) the two workaround
// plugins from src/workarounds/.
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ySyncPlugin, initProseMirrorDoc } from '@tiptap/y-tiptap';
import { schema } from './schema.js';
import { FRAGMENT_NAME } from './yjs.js';
import { rootAttrsPlugin, type RootAttrsStats } from './workarounds/rootAttrs.js';
import { leafMarksPlugin, type LeafMarksStats } from './workarounds/leafMarks.js';

export interface LiveClientOptions {
  /** ws://127.0.0.1:<port> */
  url: string;
  docName: string;
  token?: string;
  /** Default true: attach both stack-13 workaround plugins. */
  withWorkarounds?: boolean;
  /**
   * Brief 03 / gate E: force this Y.Doc's clientID instead of Yjs's own
   * random one. Only ever used to construct a deliberate client-ID
   * collision between two different tokens/users, to test the relay's
   * attribution conflict detection (src/attribution.ts).
   */
  clientId?: number;
}

export interface WorkaroundStats {
  rootAttrs: RootAttrsStats;
  leafMarks: LeafMarksStats;
}

export interface LiveClient {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  /**
   * The dedicated network transport for this client (gate G/E: disconnect()/
   * connect() on this, not on `provider` -- HocuspocusProvider.connect()/
   * disconnect() are no-ops whenever an explicit websocketProvider was
   * supplied at construction, which createLiveClient always does, per the
   * `manageSocket` note above `provider.attach()` below).
   */
  websocketProvider: HocuspocusProviderWebsocket;
  view: EditorView;
  stats: WorkaroundStats;
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
 * Async because the editor must not be built until the provider's initial
 * sync has actually delivered the relay's content: `initProseMirrorDoc`
 * reads the Y.XmlFragment synchronously, and a freshly created Y.Doc has no
 * content at all until the first server round trip completes. Building the
 * mapping/EditorState from an empty fragment before that (measured
 * directly: doc.toJSON() came back as an empty doc even though the meta Map
 * -- lead/eol -- had already arrived) leaves ySyncPlugin holding a mapping
 * for a document that's about to be silently replaced, since
 * `initProseMirrorDoc`'s mapping is only rebuilt by `_forceRerender()` when
 * no mapping is passed at all (see spike 2's y-prosemirror.spec.ts comment).
 */
export async function createLiveClient(opts: LiveClientOptions): Promise<LiveClient> {
  const ydoc = new Y.Doc();
  if (opts.clientId !== undefined) ydoc.clientID = opts.clientId;
  // jsdom (used for the ProseMirror EditorView below) has no real
  // WebSocket, so the websocket transport is built explicitly with the
  // `ws` package as its polyfill, then handed to the provider.
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: opts.url,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: opts.docName,
    document: ydoc,
    token: opts.token ?? 'anonymous',
  });
  // Passing an explicit `websocketProvider` (needed for WebSocketPolyfill,
  // above) leaves `manageSocket` false, so the provider's constructor skips
  // its own `attach()` call (see node_modules/@hocuspocus/provider's
  // HocuspocusProvider constructor: `if (this.manageSocket) this.attach();`)
  // -- without this, the provider never wires up its listeners on the
  // websocket transport (no auth, no sync, `isSynced` stays false forever).
  provider.attach();

  await waitForProviderSynced(provider);

  const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);
  const { doc: initialDoc, mapping } = initProseMirrorDoc(fragment, schema);

  const stats: WorkaroundStats = {
    rootAttrs: { mapWrites: 0, docWrites: 0 },
    leafMarks: { attrWrites: 0, restores: 0 },
  };

  // leafMarksPlugin MUST come before rootAttrsPlugin here. Both plugins'
  // view() hooks run in this order at construction; rootAttrsPlugin's
  // view() hook can dispatch a transaction (bringing doc.attrs in line
  // with an already-populated phraise-doc Y.Map), and ProseMirror runs
  // *every* plugin's appendTransaction on any dispatch, regardless of
  // whether that plugin's own view() has run yet. If leafMarksPlugin
  // hasn't restored marks yet when that happens, its appendTransaction
  // reads the (still-unrestored, still-empty) live marks as ground truth
  // and overwrites the leafMarks attr with them -- destroying the encoded
  // marks before its own view() hook gets a chance to use them. Measured
  // directly: with the opposite order, every image's link mark was gone
  // by the time createLiveClient() returned, in both the returned editor
  // and (since the attr-clearing edit is itself a real transaction that
  // syncs to Yjs) the relay's stored document.
  const plugins = [ySyncPlugin(fragment, { mapping })];
  if (opts.withWorkarounds !== false) {
    plugins.push(leafMarksPlugin(stats.leafMarks));
    plugins.push(rootAttrsPlugin(ydoc, stats.rootAttrs));
  }

  const state = EditorState.create({ doc: initialDoc, schema, plugins });
  const view = new EditorView(document.createElement('div'), { state });

  return {
    ydoc,
    provider,
    websocketProvider,
    view,
    stats,
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
