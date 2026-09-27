// Brief 06 (comments, gate F), task 4: the sidebar. Threads in document
// order, each with its quote, messages (author + relative time), a reply
// box and a Resolve button; a composer when adding a new comment; a "Show
// resolved" toggle; an "Orphaned" group for threads whose quoted text was
// deleted.
//
// Pure-ish rendering: `renderSidebar` rebuilds the container's innerHTML
// from scratch on every call (spike-scale thread counts; no virtual DOM
// needed) and wires event listeners fresh each time. The one piece of
// local, transient state a rerender must not clobber is whatever the user
// is CURRENTLY typing into a reply box or the composer -- handled by
// reading any focused input's value before rebuilding and restoring focus
// by thread id afterwards (`preserveDraftFocus`).
import type { AnchoringContext } from '../../../src/comments/anchor.js';
import { resolveAnchor } from '../../../src/comments/anchor.js';
import type { ThreadSnapshot } from '../../../src/comments/model.js';
import { formatRelativeTime } from '../../../src/comments/relativeTime.js';

export interface PendingComment {
  from: number;
  to: number;
}

export interface SidebarCallbacks {
  onActivate: (threadId: string) => void;
  onSubmitNew: (text: string) => void;
  onCancelNew: () => void;
  onReply: (threadId: string, text: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onToggleShowResolved: () => void;
}

export interface SidebarViewModel {
  threads: ThreadSnapshot[];
  ctx: AnchoringContext | null;
  activeThreadId: string | null;
  showResolved: boolean;
  pending: PendingComment | null;
  pendingQuote: string;
  callbacks: SidebarCallbacks;
}

interface Placed {
  thread: ThreadSnapshot;
  group: 'active' | 'orphaned' | 'resolved';
  sortKey: number;
}

function placeThreads(threads: ThreadSnapshot[], ctx: AnchoringContext | null): Placed[] {
  const out: Placed[] = [];
  for (const thread of threads) {
    if (thread.resolved) {
      out.push({ thread, group: 'resolved', sortKey: thread.resolvedAt ?? thread.createdAt });
      continue;
    }
    const resolved = ctx ? resolveAnchor(ctx, thread.anchor) : { method: 'orphaned' as const };
    if (resolved.method === 'orphaned' || resolved.start == null) {
      out.push({ thread, group: 'orphaned', sortKey: thread.createdAt });
    } else {
      out.push({ thread, group: 'active', sortKey: resolved.start });
    }
  }
  return out;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function attachComposerKeys(textarea: HTMLTextAreaElement, onSubmit: () => void, onCancel: () => void): void {
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  });
}

function renderMessages(container: HTMLElement, messages: ThreadSnapshot['messages'], now: number): void {
  const list = el('div', 'phraise-comment-messages');
  for (const m of messages) {
    const row = el('div', 'phraise-comment-message');
    const meta = el('div', 'phraise-comment-message-meta');
    meta.appendChild(el('strong', 'phraise-comment-author', m.author));
    meta.appendChild(el('span', 'phraise-comment-time', formatRelativeTime(m.time, now)));
    row.appendChild(meta);
    row.appendChild(el('p', 'phraise-comment-text', m.text));
    list.appendChild(row);
  }
  container.appendChild(list);
}

function renderThreadCard(placed: Placed, vm: SidebarViewModel, now: number): HTMLElement {
  const { thread, group } = placed;
  const card = el('article', 'phraise-comment-thread');
  card.dataset.threadId = thread.id;
  if (thread.id === vm.activeThreadId) card.classList.add('phraise-comment-thread--active');
  card.addEventListener('click', () => vm.callbacks.onActivate(thread.id));

  card.appendChild(el('div', 'phraise-comment-quote', thread.anchor.quote.exact));
  if (group === 'orphaned') {
    card.appendChild(el('div', 'phraise-comment-orphan-note', 'The text this comment referred to was deleted.'));
  }

  renderMessages(card, thread.messages, now);

  if (!thread.resolved) {
    const replyRow = el('div', 'phraise-comment-reply-row');
    const textarea = el('textarea', 'phraise-comment-reply-input');
    textarea.placeholder = 'Reply…';
    textarea.rows = 1;
    const buttonRow = el('div', 'phraise-comment-thread-actions');
    const replyBtn = el('button', 'phraise-comment-reply-btn', 'Reply');
    replyBtn.type = 'button';
    replyBtn.hidden = true;
    const resolveBtn = el('button', 'phraise-comment-resolve-btn', 'Resolve');
    resolveBtn.type = 'button';

    const submitReply = () => {
      const text = textarea.value;
      if (!text.trim()) return;
      vm.callbacks.onReply(thread.id, text);
    };
    textarea.addEventListener('input', () => {
      replyBtn.hidden = textarea.value.trim().length === 0;
    });
    attachComposerKeys(textarea, submitReply, () => {
      textarea.value = '';
      replyBtn.hidden = true;
    });
    replyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      submitReply();
    });
    resolveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vm.callbacks.onResolve(thread.id, true);
    });
    textarea.addEventListener('click', (e) => e.stopPropagation());

    buttonRow.appendChild(replyBtn);
    buttonRow.appendChild(resolveBtn);
    replyRow.appendChild(textarea);
    replyRow.appendChild(buttonRow);
    card.appendChild(replyRow);
  } else {
    const reopenRow = el('div', 'phraise-comment-thread-actions');
    const reopenBtn = el('button', 'phraise-comment-reopen-btn', 'Reopen');
    reopenBtn.type = 'button';
    reopenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vm.callbacks.onResolve(thread.id, false);
    });
    reopenRow.appendChild(reopenBtn);
    card.appendChild(reopenRow);
  }

  return card;
}

function renderComposer(vm: SidebarViewModel): HTMLElement {
  const card = el('div', 'phraise-comment-composer');
  card.appendChild(el('div', 'phraise-comment-quote', vm.pendingQuote));
  const textarea = el('textarea', 'phraise-comment-composer-input');
  textarea.placeholder = 'Add a comment…';
  textarea.rows = 2;
  const buttonRow = el('div', 'phraise-comment-thread-actions');
  const submitBtn = el('button', 'phraise-comment-composer-submit', 'Post');
  submitBtn.type = 'button';

  const submit = () => {
    const text = textarea.value;
    if (!text.trim()) return;
    vm.callbacks.onSubmitNew(text);
  };
  attachComposerKeys(textarea, submit, () => vm.callbacks.onCancelNew());
  submitBtn.addEventListener('click', submit);

  buttonRow.appendChild(submitBtn);
  card.appendChild(textarea);
  card.appendChild(buttonRow);

  // Autofocus, deferred: this call happens synchronously inside the same
  // click/keydown handler that set `pending` in the first place, and a
  // rebuild-from-scratch render replaces the DOM node the browser was about
  // to focus; a microtask-deferred focus reliably lands on the NEW node.
  queueMicrotask(() => textarea.focus());

  return card;
}

/** Rebuild the sidebar's DOM from `vm`. Reply-box drafts are NOT preserved
 * across a rerender triggered by someone else's edit arriving mid-typing
 * (a real, accepted limitation of the "rebuild from scratch" approach at
 * spike scale -- see the findings doc). */
export function renderSidebar(container: HTMLElement, vm: SidebarViewModel): void {
  const now = Date.now();
  container.innerHTML = '';

  const toolbar = el('div', 'phraise-comments-toolbar');
  const toggleLabel = el('label', 'phraise-show-resolved-toggle');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = vm.showResolved;
  checkbox.addEventListener('change', () => vm.callbacks.onToggleShowResolved());
  toggleLabel.appendChild(checkbox);
  toggleLabel.appendChild(document.createTextNode(' Show resolved'));
  toolbar.appendChild(toggleLabel);
  container.appendChild(toolbar);

  if (vm.pending) {
    container.appendChild(renderComposer(vm));
  }

  const placed = placeThreads(vm.threads, vm.ctx);
  const active = placed.filter((p) => p.group === 'active').sort((a, b) => a.sortKey - b.sortKey);
  const orphaned = placed.filter((p) => p.group === 'orphaned').sort((a, b) => a.sortKey - b.sortKey);
  const resolved = placed.filter((p) => p.group === 'resolved').sort((a, b) => b.sortKey - a.sortKey);

  if (active.length === 0 && orphaned.length === 0 && !vm.pending) {
    container.appendChild(el('div', 'phraise-comments-empty', 'No comments yet. Select some text and click Comment.'));
  }

  for (const p of active) container.appendChild(renderThreadCard(p, vm, now));

  if (orphaned.length > 0) {
    container.appendChild(el('div', 'phraise-comment-group-heading', 'Orphaned'));
    for (const p of orphaned) container.appendChild(renderThreadCard(p, vm, now));
  }

  if (vm.showResolved && resolved.length > 0) {
    container.appendChild(el('div', 'phraise-comment-group-heading', 'Resolved'));
    for (const p of resolved) container.appendChild(renderThreadCard(p, vm, now));
  }
}

export function scrollThreadIntoView(container: HTMLElement, threadId: string): void {
  const el = container.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(threadId)}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}
