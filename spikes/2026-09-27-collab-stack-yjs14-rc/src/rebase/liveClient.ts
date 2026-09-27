// Brief 06 task 3/4: a live client for spike 2's own schema/fragment, wired
// the same way src/client-hocuspocus.ts wires spike 1's -- a Y.Doc, a
// HocuspocusProvider over `ws`, and a real ProseMirror EditorView with
// `@y/prosemirror`'s `syncPlugin`/`configureYProsemirror` on PM_FRAGMENT
// ("pm", spike 2's own name) with spike 2's own `schema` -- but with the
// integration hook (src/rebase/liveIntegration.ts) attached too, which
// src/client-hocuspocus.ts has no need for.
//
// No workaround plugins here, same as stack13's own gate F: spike 2's
// schema has no root `doc` attrs and no inline atom leaf nodes, so neither
// of stack13's two known y-tiptap losses applies -- and this binding
// (`@y/prosemirror`) doesn't lose either one anyway (src/yjs.ts's header).
import * as Y from "yjs";
import WebSocket from "ws";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { syncPlugin, configureYProsemirror } from "@y/prosemirror";
import { schema } from "./schema.js";
import { PM_FRAGMENT } from "./seed.js";
import { attachIntegrationHook, isProviderOrigin, type IntegrationHookHandle } from "./liveIntegration.js";

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
    provider.on("synced", function handler() {
      provider.off("synced", handler);
      resolve();
    });
  });
}

/**
 * Async for the same reason as src/client-hocuspocus.ts's createLiveClient:
 * the editor must not be bound to the shared type until the provider's
 * first sync has actually delivered the relay's content.
 *
 * The integration hook is attached to `ydoc` *before* awaiting that first
 * sync (not after), so a client connecting *after* a rebase has already
 * happened still runs integrate() over the batch that brings it -- exactly
 * the case a fresh reconnect (bob) needs: the very first sync a
 * reconnecting client receives is itself a "remote batch" by
 * isProviderOrigin's definition.
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
    document: ydoc as unknown as ConstructorParameters<typeof HocuspocusProvider>[0]["document"],
    token: opts.token ?? "anonymous",
  });
  provider.attach();

  const integrationHook = attachIntegrationHook(ydoc, { isRemoteOrigin: isProviderOrigin(provider) });

  await waitForProviderSynced(provider);

  const state0 = EditorState.create({ schema, plugins: [syncPlugin()] });
  const view = new EditorView(globalThis.document.createElement("div"), { state: state0 });
  const ytype = (ydoc as unknown as { get: (name: string) => any }).get(PM_FRAGMENT);
  configureYProsemirror({ ytype })(view.state, view.dispatch);

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
