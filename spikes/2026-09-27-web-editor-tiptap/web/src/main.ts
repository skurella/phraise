// Spike 7, brief 01: the page. Vanilla TypeScript, no framework. Opens a
// Markdown file the server seeded from disk (`/?doc=<relpath>&user=<name>`),
// builds a Tiptap 3 editor on spike 1's own schema (through the converter in
// src/collab/tiptapExtensions.ts -- no StarterKit, no extension that adds a
// node or mark), wires it to the relay through Collaboration +
// CollaborationCaret, and shows the serialized Markdown in a side panel.
import * as Y from 'yjs';
import { Node as PMNode } from 'prosemirror-model';
import { Editor, Node as TiptapNode, type AnyExtension } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildTiptapExtensions } from '../../src/collab/tiptapExtensions.js';
import { PhraiseWorkarounds } from '../../src/collab/tiptapWorkaroundsExtension.js';
import { FRAGMENT_NAME } from '../../src/model/yjs.js';
import { schema } from '../../src/model/schema.js';
import { serializeDoc } from '../../src/model/serialize.js';
import { FreshSrc } from '../../src/editing/freshSrc.js';
import { stripEmptyTopLevelParagraphs } from '../../src/editing/stripEmptyParagraphs.js';
import { MarkdownInputRules } from './editing/inputRulesExtension.js';
import { EnterConversions } from './editing/enterConversions.js';
import { MarkShortcuts } from './editing/markShortcuts.js';
import { LinkShortcut } from './editing/linkShortcut.js';
import { ListKeymap } from './editing/listKeymap.js';
import { TableKeymap } from './editing/tableKeymap.js';
import { MarkdownPasteRule } from './editing/pasteRule.js';
import { MarkdownCopyRule } from './editing/copyRule.js';
import { SourceBlockKeymap } from './editing/sourceBlockKeymap.js';
import { UnverifiedCheck, debugStats as unverifiedCheckDebugStats } from './editing/unverifiedCheck.js';
import { rawBlockNodeView } from './nodeviews/rawBlockView.js';
import { rawInlineNodeView } from './nodeviews/rawInlineView.js';
import { codeBlockNodeView } from './nodeviews/codeBlockView.js';
import 'katex/dist/katex.min.css';

interface PhraiseWindowHook {
  editor: Editor;
  markdown(): string;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  /** Test-only (gate H): see `unverifiedCheck.ts`'s `debugStats` comment. */
  debugUnverifiedCheckRuns(): number;
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
  const userNameEl = document.getElementById('user-name')!;
  const editorEl = document.getElementById('editor')!;
  const markdownToggle = document.getElementById('markdown-toggle')! as HTMLButtonElement;
  const markdownPanel = document.getElementById('markdown-panel')!;
  const markdownOutput = document.getElementById('markdown-output')!;

  // Brief 03, task 6: the top bar shows the document name and the user's
  // name as two separate elements (rather than one combined string), so
  // each can be styled and located independently.
  docNameEl.textContent = docName || '(no ?doc= given)';
  userNameEl.textContent = docName ? userName : '';

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
  // CollaborationCaret, then the wrapped workaround plugins, then brief 02's
  // editing extensions (typing/shortcuts/lists/tables/paste/copy -- see
  // `src/editing/`'s and `web/src/editing/`'s own comments for what each
  // one does and why).
  //
  // The relative order AMONG the keyboard-shortcut extensions here
  // (`ListKeymap`, `TableKeymap`, `EnterConversions`, `LinkShortcut`,
  // `MarkShortcuts`) matters for one reason: `@tiptap/core` reverses
  // extensions before turning them into plugins (confirmed by reading its
  // `get plugins()`; see `listKeymap.ts`'s comment), so the LAST one in this
  // array is tried FIRST for a key two of them both bind, and a handler
  // returning `false` falls through to the next. `TableKeymap` is placed
  // after `ListKeymap` so Tab/Shift-Tab try table-cell navigation before
  // list nesting; `ListKeymap` is placed after `EnterConversions` so Enter
  // tries "add a list item" before "convert this paragraph to a fence/rule".
  // None of this matters for `FreshSrc`, `MarkdownInputRules`,
  // `MarkdownPasteRule`, or `MarkdownCopyRule`: the first is an
  // `appendTransaction` plugin (runs regardless of position), and the other
  // three bind no keys that anything else here also binds.
  // Brief 03, task 2/4: node views are added by `.extend()`-ing the
  // specific generically-converted extensions by name, never by hand-
  // writing a new Node/Mark (that would risk `checkSchemaEquivalence`
  // drifting from `src/model/schema.ts`). `.extend()` only adds config
  // (here, `addNodeView`); it changes no compared field
  // (content/group/inline/atom/marks/code/attrs), so schema equivalence is
  // unaffected -- confirmed by re-running `test/schemaEquivalence.spec.ts`
  // after this change.
  const baseExtensions = buildTiptapExtensions().map((ext) => {
    if (!(ext instanceof TiptapNode)) return ext;
    if (ext.name === 'raw_block') return ext.extend({ addNodeView: rawBlockNodeView });
    if (ext.name === 'raw_inline') return ext.extend({ addNodeView: rawInlineNodeView });
    if (ext.name === 'code_block') return ext.extend({ addNodeView: codeBlockNodeView });
    return ext;
  });

  const extensions: AnyExtension[] = [
    ...baseExtensions,
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
    FreshSrc,
    UnverifiedCheck,
    MarkdownInputRules,
    MarkShortcuts,
    LinkShortcut,
    EnterConversions,
    ListKeymap,
    TableKeymap,
    SourceBlockKeymap,
    MarkdownPasteRule,
    MarkdownCopyRule,
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
    // Brief 03, task 1: an empty top-level paragraph (Enter pressed twice)
    // has no Markdown form; strip it before handing the doc to
    // `serializeDoc` rather than let it throw.
    return serializeDoc(stripEmptyTopLevelParagraphs(doc));
  }

  window.phraise = {
    editor,
    markdown,
    ydoc,
    provider,
    debugUnverifiedCheckRuns: () => unverifiedCheckDebugStats.checkRuns,
  };

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
