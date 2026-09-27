// Brief 05 task 3: a live client for spike 2's own schema/fragment, wired
// the same way src/client.ts wires spike 1's -- a Y.Doc, a
// HocuspocusProvider over `ws` (jsdom has no real WebSocket), and a real
// ProseMirror EditorView with ySyncPlugin from @tiptap/y-tiptap -- but on
// PM_FRAGMENT ("pm", spike 2's own name) with spike 2's own `schema`
// (src/rebase/schema.ts), and with the integration hook
// (src/rebase/liveIntegration.ts) attached instead of stack 13's two
// workaround plugins.
//
// No workaround plugins here: spike 2's schema has neither of stack 13's
// two known y-tiptap losses -- no attributes on the root `doc` node at all
// (`doc: { content: "block+" }`, no attrs in the spec), and no inline atom
// leaf nodes (`text` is the only inline group member; marks are on runs of
// text, which y-tiptap/y-prosemirror already encode losslessly as Y.XmlText
// formatting, the case spike 1's gate A3 never lost). So the plain,
// unpatched binding is exactly right for this schema.
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ySyncPlugin, initProseMirrorDoc } from '@tiptap/y-tiptap';
import { schema } from './schema.js';
import { PM_FRAGMENT } from './seed.js';
import { attachIntegrationHook, isProviderOrigin, type IntegrationHookHandle } from './liveIntegration.js';

export interface RebaseLiveClientOptions {
  /** ws://127.0.0.1:<port> */
  url: string;
  docName: string;
  token?: string;
}

export interface RebaseLiveClient {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  websocketProvider: HocuspocusProviderWebsocket;
  view: EditorView;
  integrationHook: IntegrationHookHandle;
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
 * Async for the same reason as src/client.ts's createLiveClient: the editor
 * must not be built from the fragment until the provider's first sync has
 * actually landed, or ySyncPlugin's mapping is built from an empty doc that
 * is about to be silently replaced.
 *
 * The integration hook is attached to `ydoc` *before* awaiting that first
 * sync (not after), so a client connecting *after* a rebase has already
 * happened still runs integrate() over the batch that brings it -- exactly
 * the case a fresh reconnect (bob, task 4) needs: the very first sync a
 * reconnecting client receives is itself a "remote batch" by
 * isProviderOrigin's definition (@hocuspocus/provider tags it with the same
 * `provider` origin as any later update, first sync or not).
 */
export async function createRebaseLiveClient(opts: RebaseLiveClientOptions): Promise<RebaseLiveClient> {
  const ydoc = new Y.Doc({ gc: false }); // brief constraint: gc:false on every client
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
  provider.attach();

  const integrationHook = attachIntegrationHook(ydoc, { isRemoteOrigin: isProviderOrigin(provider) });

  await waitForProviderSynced(provider);

  const fragment = ydoc.getXmlFragment(PM_FRAGMENT);
  const { doc: initialDoc, mapping } = initProseMirrorDoc(fragment, schema);
  const plugins = [ySyncPlugin(fragment, { mapping })];
  const state = EditorState.create({ doc: initialDoc, schema, plugins });
  const view = new EditorView(globalThis.document.createElement('div'), { state });

  return {
    ydoc,
    provider,
    websocketProvider,
    view,
    integrationHook,
    waitForSynced: () => waitForProviderSynced(provider),
    destroy() {
      integrationHook.detach();
      view.destroy();
      provider.destroy();
      websocketProvider.destroy();
    },
  };
}
