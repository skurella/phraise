// Spike 7, brief 01: the page. Vanilla TypeScript, no framework. Opens a
// Markdown file the server seeded from disk (`/?doc=<relpath>&user=<name>`),
// builds a Tiptap 3 editor on spike 1's own schema (through the converter in
// src/collab/tiptapExtensions.ts -- no StarterKit, no extension that adds a
// node or mark), wires it to the relay through Collaboration +
// CollaborationCaret, and shows the serialized Markdown in a side panel.
//
// Brief 04 additions: a presence badge row and per-user caret colours
// (`src/collab/presence.ts` + `presenceView.ts`), an image-address/link
// popover (`editing/imagePopover.ts`), `y-indexeddb` local persistence plus
// a hand-written service worker for the offline path (`offlineShell.ts`),
// and a "Saved"/"Offline.../"Reconnecting" status indicator
// (`src/offline/status.ts` + `statusView.ts`). Undo/redo need no new wiring:
// `@tiptap/extension-collaboration` (already below) binds Mod-Z/Mod-Shift-Z/
// Mod-Y to a real per-client Yjs `UndoManager` on its own.
import * as Y from 'yjs';
import { IndexeddbPersistence, storeState as storeIndexeddbState } from 'y-indexeddb';
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
import { colorForName } from '../../src/collab/presence.js';
import { createBuildGate, type GateSource } from '../../src/offline/editorGate.js';
import { createPendingWriteTracker } from '../../src/offline/pendingWrites.js';
import type { ProviderConnectionStatus } from '../../src/offline/status.js';
import { FreshSrc } from '../../src/editing/freshSrc.js';
import { stripEmptyTopLevelParagraphs } from '../../src/editing/stripEmptyParagraphs.js';
import { MarkdownInputRules } from './editing/inputRulesExtension.js';
import { EnterConversions } from './editing/enterConversions.js';
import { MarkShortcuts } from './editing/markShortcuts.js';
import { LinkShortcut } from './editing/linkShortcut.js';
import { ImagePopover } from './editing/imagePopover.js';
import { ListKeymap } from './editing/listKeymap.js';
import { TableKeymap } from './editing/tableKeymap.js';
import { MarkdownPasteRule } from './editing/pasteRule.js';
import { MarkdownCopyRule } from './editing/copyRule.js';
import { SourceBlockKeymap } from './editing/sourceBlockKeymap.js';
import { UnverifiedCheck, debugStats as unverifiedCheckDebugStats } from './editing/unverifiedCheck.js';
import { rawBlockNodeView } from './nodeviews/rawBlockView.js';
import { rawInlineNodeView } from './nodeviews/rawInlineView.js';
import { codeBlockNodeView } from './nodeviews/codeBlockView.js';
import { renderPresenceBadges } from './presenceView.js';
import { renderStatus } from './statusView.js';
import { registerServiceWorker, primeOfflineCache } from './offlineShell.js';
import 'katex/dist/katex.min.css';

interface PhraiseWindowHook {
  editor: Editor;
  markdown(): string;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  /** Test-only (gate H): see `unverifiedCheck.ts`'s `debugStats` comment. */
  debugUnverifiedCheckRuns(): number;
  /** Test-only (gate I): which source (`'indexeddb'` or `'provider'`) the editor was actually built from. */
  builtFrom: GateSource;
  /** Test-only (gate I): forces the y-indexeddb write queue to a full snapshot and resolves once that write has completed, so a test can close/reload the page deterministically instead of guessing at IndexedDB write timing. */
  flushIndexeddb(): Promise<void>;
  /** Test-only (gate I): resolves once the service worker is active and the app shell has been explicitly primed into the cache. */
  offlineReady: Promise<void>;
  /** Test-only (gate I): the current status label shown in the top bar. */
  statusLabel(): string;
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

function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function main(): Promise<void> {
  const { docName, userName } = readParams();
  const docNameEl = document.getElementById('doc-name')!;
  const userNameEl = document.getElementById('user-name')!;
  const editorEl = document.getElementById('editor')!;
  const markdownToggle = document.getElementById('markdown-toggle')! as HTMLButtonElement;
  const markdownPanel = document.getElementById('markdown-panel')!;
  const markdownOutput = document.getElementById('markdown-output')!;
  const presenceBadgesEl = document.getElementById('presence-badges')!;
  const statusEl = document.getElementById('status-indicator')!;

  // Brief 03, task 6: the top bar shows the document name and the user's
  // name as two separate elements (rather than one combined string), so
  // each can be styled and located independently.
  docNameEl.textContent = docName || '(no ?doc= given)';
  userNameEl.textContent = docName ? userName : '';

  if (!docName) {
    editorEl.textContent = 'Open this page with ?doc=<relpath>&user=<name>. See GET /api/files for available files.';
    return;
  }

  // Brief 04, task 5: register the shell service worker as early as
  // possible. This does not gate anything below -- it runs in the
  // background and `window.phraise.offlineReady` (set further down) is how
  // a test waits for it deterministically before simulating a network
  // drop.
  let resolveOfflineReady!: () => void;
  const offlineReadyPromise = new Promise<void>((resolve) => {
    resolveOfflineReady = resolve;
  });

  const config = (await fetch('/config.json').then((r) => r.json())) as { relayUrl: string };

  const ydoc = new Y.Doc();

  // Brief 04, task 5: one IndexedDB database per document name (not per
  // user/session), so any tab/reload for this same doc in this browser
  // profile shares the same local history.
  const persistence = new IndexeddbPersistence(`phraise-doc:${docName}`, ydoc);

  const provider = new HocuspocusProvider({
    url: config.relayUrl,
    name: `file:${docName}`,
    document: ydoc,
    token: userName,
  });

  // Brief 04, task 5: the status indicator tracks two independent facts --
  // whether the BROWSER is online at all, and whether the relay WebSocket
  // is `connected` -- wired as soon as the provider exists, not gated
  // behind the editor build, so the indicator is live through the initial
  // connecting phase too.
  //
  // Brief 05, task 4: a third fact -- whether any local edit's write to
  // IndexedDB is still in flight (`pendingWrites`, `src/offline/
  // pendingWrites.ts`) -- so the indicator can show "Saving on this
  // device" until it settles, then "Offline, changes kept on this device".
  // `flushIndexeddb()` below is deliberately reused as the tracker's own
  // flush function: one real, durable write of the CURRENT doc state per
  // local update (see the tracker's own file comment for why this needs no
  // de-duplication).
  let browserOnline = navigator.onLine;
  let providerStatus: ProviderConnectionStatus = 'connecting';
  function updateStatus(): void {
    renderStatus(statusEl, browserOnline, providerStatus, pendingWrites.pendingCount() > 0);
  }
  const pendingWrites = createPendingWriteTracker(
    ydoc,
    () => storeIndexeddbState(persistence, true).then(() => undefined),
    updateStatus,
    persistence,
  );
  provider.on('status', ({ status }: { status: ProviderConnectionStatus }) => {
    providerStatus = status;
    updateStatus();
  });
  window.addEventListener('online', () => {
    browserOnline = true;
    updateStatus();
  });
  window.addEventListener('offline', () => {
    browserOnline = false;
    updateStatus();
  });
  updateStatus();

  // Brief 05, task 4: flush on `pagehide` and `visibilitychange` (going
  // hidden) -- the two events a real tab close/navigation/app-switch
  // reliably fires before the page may disappear, so any local edit typed
  // just before closing gets one more explicit attempt at reaching
  // IndexedDB rather than waiting on whatever triggered the last flush.
  // This narrows, but (per the platform's own guarantees, or lack of them)
  // cannot fully close, the loss window a synchronous tab close leaves for
  // an async IndexedDB write in flight -- measured, not assumed, by gate
  // I's own "type then close at once" test (see the builder log).
  function flushOnHide(): void {
    void pendingWrites.flushNow();
  }
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });

  // Brief 05, task 4: "when offline with changes that the relay has not
  // acknowledged, register a beforeunload prompt, as Google Docs does."
  // Only while offline AND a write is still in flight -- online, the relay
  // (not just IndexedDB) is the durable store, and once every write has
  // settled there is nothing left for a close to lose.
  window.addEventListener('beforeunload', (e) => {
    if (!browserOnline && pendingWrites.pendingCount() > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Brief 04, task 5: build the editor after whichever comes first --
  // IndexedDB loaded WITH CONTENT (a previous offline session already wrote
  // something locally), or the provider's first sync. A freshly opened
  // document in a brand-new browser profile has an empty IndexedDB that
  // "loads" almost instantly; settling the gate from that alone would build
  // the editor before any real content (local OR remote) exists, which is
  // exactly the precondition spike 5's workaround plugins need violated
  // (see the plan's "Key choices" offline paragraph and D5). So the
  // IndexedDB side only settles the gate when its content is non-empty.
  const gate = createBuildGate();
  persistence.on('synced', () => {
    if (ydoc.getXmlFragment(FRAGMENT_NAME).length > 0) gate.onIndexedDBSynced();
  });
  if (provider.isSynced) gate.onProviderSynced();
  provider.on('synced', () => gate.onProviderSynced());

  const builtFrom = await gate.ready;

  const user = { name: userName, color: colorForName(userName) };

  // Extension order matches spike 5's src/tiptapClient.ts (wiring
  // reference): the converted schema, then Collaboration, then
  // CollaborationCaret, then the wrapped workaround plugins, then brief 02's
  // editing extensions (typing/shortcuts/lists/tables/paste/copy -- see
  // `src/editing/`'s and `web/src/editing/`'s own comments for what each
  // one does and why), then brief 04's `ImagePopover` (a plain click
  // handler plugin; no keyboard shortcut, so its position relative to the
  // others doesn't matter for the "last one tried first" rule below).
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
  // `MarkdownPasteRule`, `MarkdownCopyRule`, or `ImagePopover`: the first is
  // an `appendTransaction` plugin (runs regardless of position), and the
  // rest bind no keys that anything else here also binds.
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
      stats: {
        rootAttrs: { mapWrites: 0, docWrites: 0 },
        leafMarks: { attrWrites: 0, restores: 0 },
        localCaretFollow: { corrections: 0 },
      },
    }),
    FreshSrc,
    UnverifiedCheck,
    MarkdownInputRules,
    MarkShortcuts,
    LinkShortcut,
    ImagePopover,
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
    // Tiptap's base CSS is required: without `white-space: pre-wrap` on the
    // editable, Chromium inserts U+00A0 for a typed trailing space, which then
    // reaches the document and the Markdown file (found by the orchestrator).
    injectCSS: true,
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

  // Brief 04, task 1: the presence badge row re-renders whenever awareness
  // changes (a user joins/leaves/renames) -- the SAME `update` event
  // `CollaborationCaret` itself listens to for `editor.storage
  // .collaborationCaret.users` (confirmed by reading its source; see
  // `src/collab/presence.ts`'s file comment), so the two stay in sync.
  function updatePresence(): void {
    renderPresenceBadges(presenceBadgesEl, editor);
  }
  provider.awareness?.on('update', updatePresence);
  updatePresence();

  window.phraise = {
    editor,
    markdown,
    ydoc,
    provider,
    debugUnverifiedCheckRuns: () => unverifiedCheckDebugStats.checkRuns,
    builtFrom,
    flushIndexeddb: () => storeIndexeddbState(persistence, true).then(() => undefined),
    offlineReady: offlineReadyPromise,
    statusLabel: () => statusEl.textContent ?? '',
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

  // Brief 04, task 5: prime the offline cache once the page has actually
  // finished loading its own resources (so `performance`'s resource list is
  // as complete as it'll get) -- deliberately not awaited before the editor
  // exists; a test awaits `window.phraise.offlineReady` itself before
  // simulating a network drop.
  void (async () => {
    await registerServiceWorker();
    await primeOfflineCache();
    resolveOfflineReady();
  })();
}

main().catch((err) => {
  console.error('[phraise] fatal', err);
  const editorEl = document.getElementById('editor');
  if (editorEl) editorEl.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
