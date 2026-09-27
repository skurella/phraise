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
    this.unobserve = observeThreads(ydoc, () => this.render());
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
