// Brief 03, gate D: a Tiptap 3 twin of src/client.ts -- same Y.Doc/
// HocuspocusProvider wiring (same two constructor-order bugs from brief 01
// apply here identically, since Collaboration/CollaborationCaret sit on the
// exact same HocuspocusProvider), but a Tiptap `Editor` instead of a raw
// ProseMirror `EditorView`, built from buildTiptapExtensions() (the schema
// converter) plus @tiptap/extension-collaboration,
// @tiptap/extension-collaboration-caret, and PhraiseWorkarounds (the two
// workaround plugins wrapped as a Tiptap Extension).
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Editor, type AnyExtension } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { buildTiptapExtensions } from './tiptapExtensions.js';
import { FRAGMENT_NAME } from './yjs.js';
import { PhraiseWorkarounds } from './tiptapWorkaroundsExtension.js';
import type { WorkaroundStats } from './client.js';

// jsdom implements neither Range.getClientRects/getBoundingClientRect nor
// Element.getClientRects/getBoundingClientRect (confirmed directly: `'get
// ClientRects' in Range.prototype` is false in this jsdom version).
// prosemirror-view's scrollToSelection (called whenever a focused editor's
// selection changes, which real focus -- gate D's caret test needs --
// triggers) calls `target.getClientRects()` unconditionally and crashes
// without this. Brief 01 hit the same class of gap for jsdom's missing
// ClipboardEvent constructor (gates/lib/edits.ts's pasteHTMLAt); this is
// the same kind of narrow, documented shim, not a general jsdom patch --
// scoped to this file (only gate D ever focuses an editor) and guarded so
// it's a no-op if a future jsdom version adds real support.
const ZERO_RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
for (const proto of [globalThis.Range?.prototype, globalThis.Element?.prototype]) {
  if (proto && !('getClientRects' in proto)) {
    (proto as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () => [];
  }
  if (proto && !('getBoundingClientRect' in proto)) {
    (proto as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ZERO_RECT;
  }
}

export interface TiptapLiveClientOptions {
  url: string;
  docName: string;
  token?: string;
  user: { name: string; color: string };
  /** Default true: attach both stack-13 workaround plugins (as one wrapped Tiptap Extension). */
  withWorkarounds?: boolean;
}

export interface TiptapLiveClient {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  websocketProvider: HocuspocusProviderWebsocket;
  editor: Editor;
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

/** Same async-before-building-the-editor requirement as src/client.ts's createLiveClient, and for the same reason (see its doc comment). */
export async function createTiptapLiveClient(opts: TiptapLiveClientOptions): Promise<TiptapLiveClient> {
  const ydoc = new Y.Doc();
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
  provider.attach(); // see src/client.ts's comment: required whenever an explicit websocketProvider is supplied.

  await waitForProviderSynced(provider);

  const stats: WorkaroundStats = {
    rootAttrs: { mapWrites: 0, docWrites: 0 },
    leafMarks: { attrWrites: 0, restores: 0 },
  };

  const extensions: AnyExtension[] = [
    ...buildTiptapExtensions(),
    Collaboration.configure({ document: ydoc, field: FRAGMENT_NAME }),
    CollaborationCaret.configure({
      provider,
      user: opts.user,
      render: (user) => {
        const el = window.document.createElement('span');
        el.classList.add('collaboration-cursor__caret');
        el.setAttribute('data-user-name', user.name as string);
        el.style.borderColor = user.color as string;
        return el;
      },
      selectionRender: (user) => ({ nodeName: 'span', class: 'collaboration-cursor__selection', 'data-user': user.name as string }),
    }),
  ];
  if (opts.withWorkarounds !== false) {
    extensions.push(PhraiseWorkarounds.configure({ ydoc, stats }));
  }

  // Appended to document.body (not left detached): CollaborationCaret's
  // cursor broadcasting (@tiptap/y-tiptap's yCursorPlugin) only sends this
  // editor's own cursor position into awareness when `editorView.hasFocus()`
  // is true (confirmed by reading y-tiptap.cjs directly), and jsdom only
  // honors `.focus()` on an element that's actually attached to a document.
  const mount = window.document.createElement('div');
  window.document.body.appendChild(mount);
  const editor = new Editor({
    element: mount,
    extensions,
    injectCSS: false,
    autofocus: false,
  });

  return {
    ydoc,
    provider,
    websocketProvider,
    editor,
    stats,
    waitForSynced: () => waitForProviderSynced(provider),
    destroy() {
      editor.destroy();
      provider.destroy();
      websocketProvider.destroy();
      mount.remove();
    },
  };
}
