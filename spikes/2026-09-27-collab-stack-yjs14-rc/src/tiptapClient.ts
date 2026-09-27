// Brief 04, gate D: a Tiptap 3 twin of src/client-hocuspocus.ts. Same
// Y.Doc/HocuspocusProvider wiring, but a Tiptap `Editor` instead of a raw
// ProseMirror `EditorView`, with THREE custom Tiptap extensions
// (createYSyncExtension/createYCursorExtension/createYUndoExtension below)
// wrapping @y/prosemirror's syncPlugin/yCursorPlugin/yUndoPlugin directly,
// instead of Tiptap's own `@tiptap/extension-collaboration` /
// `@tiptap/extension-collaboration-caret` -- those wrap the OLD y-prosemirror
// binding (1.x, Yjs 13) and would not understand @y/prosemirror's delta
// wire format at all. This mirrors, almost line for line, how the upstream
// Tiptap 3 demo the brief names (yhub-tiptap-demo/extensions.js) wires the
// same three plugins as Tiptap extensions -- see that file's own comment:
// "We deliberately do NOT use @tiptap/extension-collaboration: it wraps the
// OLD y-prosemirror ySyncPlugin and is incompatible with the new
// attribution binding."
//
// What replaced Tiptap's own extensions, with line counts (gate D's "list
// what had to be written in place of Tiptap's extensions" ask):
//   - createYSyncExtension: ~10 lines (wraps syncPlugin()).
//   - createYCursorExtension: ~8 lines (wraps yCursorPlugin(awareness)).
//   - createYUndoExtension: ~14 lines (wraps yUndoPlugin(undoManager) plus
//     Mod-Z/Mod-Y/Mod-Shift-Z keyboard shortcuts calling undoCommand/
//     redoCommand -- Tiptap's StarterKit undoRedo is not used here at all,
//     since this package builds its extension list from
//     buildTiptapExtensions(), not StarterKit).
// Total: ~35 lines of glue (three thin Extension.create() wrappers), all in
// this file below -- no schema-level rewrite needed beyond what gate D's
// existing generic converter (src/tiptapExtensions.ts) already does.
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Editor, Extension, type AnyExtension } from '@tiptap/core';
import { syncPlugin, configureYProsemirror, yCursorPlugin, yUndoPlugin, undoCommand, redoCommand } from '@y/prosemirror';
import { buildTiptapExtensions } from './tiptapExtensions.js';
import { FRAGMENT_NAME } from './yjs.js';

// Same jsdom gap stack 13's tiptapClient.ts documents and shims: jsdom
// implements neither Range/Element.getClientRects nor
// getBoundingClientRect, and prosemirror-view's scrollToSelection (real
// focus, needed for gate D's caret test) calls the former unconditionally.
const ZERO_RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
for (const proto of [globalThis.Range?.prototype, globalThis.Element?.prototype]) {
  if (proto && !('getClientRects' in proto)) {
    (proto as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () => [];
  }
  if (proto && !('getBoundingClientRect' in proto)) {
    (proto as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ZERO_RECT;
  }
}

/** Wraps @y/prosemirror's syncPlugin() -- the ONLY thing @tiptap/extension-collaboration would otherwise provide, for the wrong (Yjs 13) binding. */
const createYSyncExtension = () =>
  Extension.create({
    name: 'ySync',
    addProseMirrorPlugins() {
      return [syncPlugin()];
    },
  });

/** Wraps @y/prosemirror's yCursorPlugin(awareness) -- @tiptap/extension-collaboration-caret's equivalent, for the wrong binding. */
const createYCursorExtension = (awareness: unknown) =>
  Extension.create({
    name: 'yCursor',
    addProseMirrorPlugins() {
      return [yCursorPlugin(awareness as never)];
    },
  });

/** Wraps @y/prosemirror's yUndoPlugin(undoManager); Yjs owns history here, so StarterKit's own undoRedo is never part of this extension list to begin with (buildTiptapExtensions() doesn't include it). */
const createYUndoExtension = (undoManager: Y.UndoManager) =>
  Extension.create({
    name: 'yUndo',
    addProseMirrorPlugins() {
      return [yUndoPlugin(undoManager as never)];
    },
    addKeyboardShortcuts() {
      return {
        'Mod-z': () => undoCommand(this.editor.state, this.editor.view.dispatch),
        'Mod-y': () => redoCommand(this.editor.state, this.editor.view.dispatch),
        'Mod-Shift-z': () => redoCommand(this.editor.state, this.editor.view.dispatch),
      };
    },
  });

export interface TiptapLiveClientOptions {
  url: string;
  docName: string;
  token?: string;
  user: { name: string; color: string };
}

export interface TiptapLiveClient {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  websocketProvider: HocuspocusProviderWebsocket;
  editor: Editor;
  undoManager: Y.UndoManager;
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

export async function createTiptapLiveClient(opts: TiptapLiveClientOptions): Promise<TiptapLiveClient> {
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

  provider.awareness!.setLocalStateField('user', { name: opts.user.name, color: opts.user.color });

  // One UndoManager per bound Y.Doc, same as the upstream demo (its own
  // comment: "Y.UndoManager hooks doc.on('afterTransaction') and its scope
  // cannot span documents"). `trackedOrigins` starts empty; yUndoPlugin's
  // own bind step adds the sync plugin instance as the tracked origin (see
  // undo-plugin.js), so only edits made through THIS editor are undoable --
  // not the provider's own sync writes or another peer's edits.
  const undoManager = new Y.UndoManager(ydoc.get(FRAGMENT_NAME) as never, { trackedOrigins: new Set() } as never);

  const extensions: AnyExtension[] = [
    ...buildTiptapExtensions(),
    createYSyncExtension(),
    createYCursorExtension(provider.awareness),
    createYUndoExtension(undoManager),
  ];

  const mount = window.document.createElement('div');
  window.document.body.appendChild(mount);
  const editor = new Editor({
    element: mount,
    extensions,
    injectCSS: false,
    autofocus: false,
  });

  // syncPlugin() alone (added above via createYSyncExtension) only sets up
  // the plugin's STATE shape; configureYProsemirror is what actually binds
  // it to a shared type and hydrates the view from Y -- same as
  // src/client-hocuspocus.ts's createLiveClient, and the upstream demo's
  // `rebind()` (which calls it on `view.state`/`view.dispatch` after
  // construction, not at Editor-construction time).
  const ytype = ydoc.get(FRAGMENT_NAME);
  configureYProsemirror({ ytype })(editor.view.state, editor.view.dispatch);

  return {
    ydoc,
    provider,
    websocketProvider,
    editor,
    undoManager,
    waitForSynced: () => waitForProviderSynced(provider),
    destroy() {
      editor.destroy();
      provider.destroy();
      websocketProvider.destroy();
      mount.remove();
    },
  };
}
