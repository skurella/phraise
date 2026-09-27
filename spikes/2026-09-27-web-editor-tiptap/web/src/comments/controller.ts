// Brief 06 (comments, gate F): the DOM-side glue between the pure model
// (`src/comments/model.ts`), the pure anchor resolver (`src/comments/
// anchor.ts`), the highlight decoration plugin (`highlightPlugin.ts`) and
// the sidebar renderer (`sidebar.ts`). Owns the only pieces of state that
// are genuinely local to this browser tab (which thread is active, whether
// a new comment is being composed, the "show resolved" toggle) -- every
// other piece of state lives in the `Y.Doc` and is shared.
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createThread, addReply, setResolved, listThreads, observeThreads } from '../../../src/comments/model.js';
import { buildAnchorRecord } from '../../../src/comments/anchor.js';
import { liveAnchoringContext } from './liveContext.js';
import { refreshCommentHighlights } from './highlightPlugin.js';
import { renderSidebar, scrollThreadIntoView, type PendingComment } from './sidebar.js';

export class CommentsController {
  private activeThreadId: string | null = null;
  private pending: PendingComment | null = null;
  private showResolved = false;
  private unobserve: () => void;

  constructor(
    private readonly editor: Editor,
    private readonly ydoc: Y.Doc,
    private readonly container: HTMLElement,
    private readonly userName: string,
  ) {
    // A thread change (new/reply/resolve) from ANY replica -- not just this
    // tab's own actions -- must refresh the highlight decorations too, not
    // only the sidebar: the threads map lives outside the ProseMirror-bound
    // fragment (by design, so comments never touch the Markdown), so a
    // remote thread update reaching this tab over the relay produces NO
    // ProseMirror transaction on its own -- nothing would otherwise tell
    // `commentHighlightPlugin` to recompute. Found by the first real gate F
    // run: Bob's sidebar updated but his highlight never appeared until
    // this was added.
    this.unobserve = observeThreads(ydoc, () => {
      this.refreshHighlights();
      this.render();
    });

    // A thread's placement in the sidebar (active/orphaned) is itself a
    // function of the DOCUMENT, not just the threads map -- a thread
    // becomes orphaned purely from a document edit (its quoted text
    // deleted), with no write to the threads map at all. The highlight
    // plugin already recomputes on every `docChanged` transaction; the
    // sidebar needs the same trigger, or a delete that orphans a thread
    // would leave it stuck showing as active until some UNRELATED thread
    // action happened to call `render()` next. Found by the first real
    // gate F "orphaned" test run: highlights correctly disappeared but the
    // sidebar kept showing the thread outside the Orphaned group.
    //
    // Debounced (250ms, same figure `main.ts` already uses for the
    // Markdown panel): every keystroke anywhere in the document is a
    // `docChanged` transaction, and rebuilding the whole sidebar on every
    // one of them -- while, say, someone else is typing a long paragraph --
    // would be wasteful and would repeatedly steal/re-set focus away from
    // whatever the user is doing in the sidebar (a focused reply/composer
    // draft survives a rerender via `sidebar.ts`'s own draft-preserving
    // logic, but there is no reason to rebuild that often in the first
    // place).
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    this.editor.on('update', ({ transaction }) => {
      if (!transaction.docChanged) return;
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => this.render(), 250);
    });
  }

  destroy(): void {
    this.unobserve();
  }

  getActiveThreadId = (): string | null => this.activeThreadId;

  startNewComment(from: number, to: number): void {
    if (from === to) return;
    this.pending = { from, to };
    this.render();
  }

  cancelNewComment(): void {
    this.pending = null;
    this.render();
  }

  submitNewComment(text: string): void {
    if (!this.pending) return;
    const ctx = liveAnchoringContext(this.editor.state);
    if (!ctx) return;
    const anchor = buildAnchorRecord(ctx, this.pending.from, this.pending.to);
    const id = createThread(this.ydoc, anchor, this.userName, text.trim(), Date.now());
    this.pending = null;
    this.activeThreadId = id;
    this.refreshHighlights();
    this.render();
  }

  submitReply(threadId: string, text: string): void {
    addReply(this.ydoc, threadId, this.userName, text.trim(), Date.now());
    this.render();
  }

  setResolved(threadId: string, resolved: boolean): void {
    setResolved(this.ydoc, threadId, resolved, this.userName, Date.now());
    this.refreshHighlights();
    this.render();
  }

  activateThread(threadId: string): void {
    this.activeThreadId = threadId;
    this.refreshHighlights();
    this.render();
    scrollThreadIntoView(this.container, threadId);
  }

  toggleShowResolved(): void {
    this.showResolved = !this.showResolved;
    this.render();
  }

  private refreshHighlights(): void {
    refreshCommentHighlights(this.editor.view);
  }

  render(): void {
    const threads = listThreads(this.ydoc);
    const ctx = liveAnchoringContext(this.editor.state);
    const pendingQuote = this.pending ? this.editor.state.doc.textBetween(this.pending.from, this.pending.to, ' ', ' ') : '';
    renderSidebar(this.container, {
      threads,
      ctx,
      activeThreadId: this.activeThreadId,
      showResolved: this.showResolved,
      pending: this.pending,
      pendingQuote,
      callbacks: {
        onActivate: (id) => this.activateThread(id),
        onSubmitNew: (text) => this.submitNewComment(text),
        onCancelNew: () => this.cancelNewComment(),
        onReply: (id, text) => this.submitReply(id, text),
        onResolve: (id, resolved) => this.setResolved(id, resolved),
        onToggleShowResolved: () => this.toggleShowResolved(),
      },
    });
  }
}
