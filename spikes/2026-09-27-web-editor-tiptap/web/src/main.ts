// Spike 7, brief 01: the page. Vanilla TypeScript, no framework. Opens a
// Markdown file the server seeded from disk (`/?doc=<relpath>&user=<name>`),
// builds a Tiptap 3 editor on spike 1's own schema (through the converter in
// src/collab/tiptapExtensions.ts -- no StarterKit, no extension that adds a
// node or mark), wires it to the relay through Collaboration +
// CollaborationCaret, and shows the serialized Markdown in a side panel.
import * as Y from 'yjs';
import { Node as PMNode } from 'prosemirror-model';
import { Editor, type AnyExtension } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildTiptapExtensions } from '../../src/collab/tiptapExtensions.js';
import { PhraiseWorkarounds } from '../../src/collab/tiptapWorkaroundsExtension.js';
import { FRAGMENT_NAME } from '../../src/model/yjs.js';
import { schema } from '../../src/model/schema.js';
import { serializeDoc } from '../../src/model/serialize.js';

interface PhraiseWindowHook {
  editor: Editor;
  markdown(): string;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

declare global {
  interface Window {
    phraise?: PhraiseWindowHook;
  }
}

function readParams(): { docName: string; userName: string } {
  const url = new URL(window.location.href);
  const docName = url.searchParams.get('doc') ?? '';
  const userName = url.searchParams.get('user') ?? 'Anonymous';
  return { docName, userName };
}

/** Deterministic HSL colour from a name, so the same user always gets the same cursor colour. */
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function waitForProviderSynced(provider: HocuspocusProvider): Promise<void> {
  if (provider.isSynced) return;
  await new Promise<void>((resolve) => {
    provider.on('synced', function handler() {
      provider.off('synced', handler);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const { docName, userName } = readParams();
  const docNameEl = document.getElementById('doc-name')!;
  const editorEl = document.getElementById('editor')!;
  const markdownToggle = document.getElementById('markdown-toggle')! as HTMLButtonElement;
  const markdownPanel = document.getElementById('markdown-panel')!;
  const markdownOutput = document.getElementById('markdown-output')!;

  docNameEl.textContent = docName ? `${docName} — ${userName}` : '(no ?doc= given)';

  if (!docName) {
    editorEl.textContent = 'Open this page with ?doc=<relpath>&user=<name>. See GET /api/files for available files.';
    return;
  }

  const config = (await fetch('/config.json').then((r) => r.json())) as { relayUrl: string };

  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: config.relayUrl,
    name: `file:${docName}`,
    document: ydoc,
    token: userName,
  });

  // Build the editor only after the provider's first sync (spike 5's
  // src/tiptapClient.ts does the same, and for the same reason: the
  // workaround plugins' initial view() hooks read the Y.Doc's content, which
  // must already reflect the server's seed/persisted state).
  await waitForProviderSynced(provider);

  const user = { name: userName, color: colorForName(userName) };

  // Extension order matches spike 5's src/tiptapClient.ts (wiring
  // reference): the converted schema, then Collaboration, then
  // CollaborationCaret, then the wrapped workaround plugins last.
  const extensions: AnyExtension[] = [
    ...buildTiptapExtensions(),
    Collaboration.configure({ document: ydoc, field: FRAGMENT_NAME }),
    CollaborationCaret.configure({
      provider,
      user,
      render: (u) => {
        const el = window.document.createElement('span');
        el.classList.add('collaboration-cursor__caret');
        el.style.borderColor = u.color as string;
        const label = window.document.createElement('span');
        label.classList.add('collaboration-cursor__label');
        label.style.backgroundColor = u.color as string;
        label.textContent = u.name as string;
        el.appendChild(label);
        return el;
      },
      selectionRender: (u) => ({ nodeName: 'span', class: 'collaboration-cursor__selection', 'data-user': u.name as string }),
    }),
    PhraiseWorkarounds.configure({
      ydoc,
      stats: { rootAttrs: { mapWrites: 0, docWrites: 0 }, leafMarks: { attrWrites: 0, restores: 0 } },
    }),
  ];

  const editor = new Editor({
    element: editorEl,
    extensions,
    injectCSS: false,
    autofocus: false,
  });

  /** Convert the editor's document into spike 1's own schema instance before
   * serializing, so no node-type identity comparisons cross schema instances
   * (Tiptap builds its own Schema object from the same NodeSpec/MarkSpecs). */
  function markdown(): string {
    const doc = PMNode.fromJSON(schema, editor.state.doc.toJSON());
    return serializeDoc(doc);
  }

  window.phraise = { editor, markdown, ydoc, provider };

  const refreshMarkdown = debounce(() => {
    if (markdownPanel.hidden) return;
    try {
      markdownOutput.textContent = markdown();
    } catch (err) {
      markdownOutput.textContent = `(serialize error: ${err instanceof Error ? err.message : String(err)})`;
    }
  }, 250);

  editor.on('update', refreshMarkdown);

  markdownToggle.addEventListener('click', () => {
    markdownPanel.hidden = !markdownPanel.hidden;
    if (!markdownPanel.hidden) refreshMarkdown();
  });
}

main().catch((err) => {
  console.error('[phraise] fatal', err);
  const editorEl = document.getElementById('editor');
  if (editorEl) editorEl.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
