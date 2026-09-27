// Brief 06 (comments, gate F), task 3: highlights. A decoration plugin (no
// marks, no schema change -- `test/schemaEquivalence.spec.ts` stays green)
// that paints every UNRESOLVED thread's currently-resolvable range with a
// soft yellow background, stronger for the active thread. A resolved
// thread is never highlighted (brief: "the highlight disappears ... and the
// thread moves under Show resolved"); an orphaned thread has no range to
// paint at all.
//
// Recomputation ("on every document change", per the brief's task 2):
// `apply` recomputes fully whenever the transaction changed the document,
// OR whenever `refreshCommentHighlights` (called from `main.ts`'s Y.Map
// observer, and from the sidebar on activate/resolve/reply) sets this
// plugin's own meta -- since a thread can change (new/resolved/replied)
// with the document itself untouched. A selection-only transaction that
// does neither is the cheap path: the previous decoration set is reused
// as-is (nothing could have changed).
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { resolveAnchor } from '../../../src/comments/anchor.js';
import { listThreads } from '../../../src/comments/model.js';
import { liveAnchoringContext } from './liveContext.js';

export const commentHighlightPluginKey = new PluginKey<CommentHighlightState>('commentHighlights');

export const REFRESH_META = 'phraiseRefreshCommentHighlights';

export interface CommentHighlightState {
  decorations: DecorationSet;
  /** threadId -> the range last painted for it (unresolved, non-orphaned threads only). Read by the sidebar to scroll/verify, and by tests. */
  ranges: Map<string, { start: number; end: number }>;
}

/**
 * Test-only visibility (gate K, scale): the wall time (ms) of the most
 * recent full re-anchoring pass (`computeState`, below) -- one
 * `resolveAnchor` call per unresolved thread, run on every document
 * change. Not read by any production code path.
 */
export const debugStats = { lastComputeMs: 0 };

function computeState(ydoc: Y.Doc, state: EditorState, activeThreadId: string | null): CommentHighlightState {
  const t0 = performance.now();
  const result = computeStateInner(ydoc, state, activeThreadId);
  debugStats.lastComputeMs = performance.now() - t0;
  return result;
}

function computeStateInner(ydoc: Y.Doc, state: EditorState, activeThreadId: string | null): CommentHighlightState {
  const ctx = liveAnchoringContext(state);
  const ranges = new Map<string, { start: number; end: number }>();
  if (!ctx) return { decorations: DecorationSet.empty, ranges };

  const decorations: Decoration[] = [];
  for (const thread of listThreads(ydoc)) {
    if (thread.resolved) continue;
    const resolved = resolveAnchor(ctx, thread.anchor);
    if (resolved.method === 'orphaned') continue;
    if (resolved.start == null || resolved.end == null || resolved.start >= resolved.end) continue;
    ranges.set(thread.id, { start: resolved.start, end: resolved.end });
    const active = thread.id === activeThreadId;
    decorations.push(
      Decoration.inline(
        resolved.start,
        resolved.end,
        {
          class: active ? 'phraise-comment-highlight phraise-comment-highlight--active' : 'phraise-comment-highlight',
          'data-thread-id': thread.id,
        },
        // `attrs` (above) is what actually renders into the DOM; `spec` (a
        // separate constructor argument, confirmed from prosemirror-view's
        // own `Decoration.inline(from, to, attrs, spec?)` signature) is
        // what `Decoration.spec` reads back below in `handleClick` -- a
        // real bug found while running this test the first time: reading
        // `data-thread-id` back off `.spec` when it was only ever set as a
        // DOM attr always returned `undefined`, so no click ever activated
        // a thread.
        { threadId: thread.id },
      ),
    );
  }
  return { decorations: DecorationSet.create(state.doc, decorations), ranges };
}

/** Dispatches a no-op (meta-only) transaction that makes the plugin
 * recompute, for a change that doesn't itself touch the document (a new
 * thread, a reply, a resolve/reopen, or the sidebar activating a different
 * thread). Safe to call often; `view.dispatch` is cheap for a transaction
 * with no steps. */
export function refreshCommentHighlights(view: { state: EditorState; dispatch: (tr: Transaction) => void }): void {
  view.dispatch(view.state.tr.setMeta(REFRESH_META, true).setMeta('addToHistory', false));
}

export interface CommentHighlightOptions {
  ydoc: Y.Doc;
  /** Returns the currently-active thread id (sidebar selection), read fresh on every recomputation. */
  getActiveThreadId: () => string | null;
  /** Called when the user clicks inside a highlighted range. */
  onActivate: (threadId: string) => void;
}

export function commentHighlightPlugin(options: CommentHighlightOptions): Plugin<CommentHighlightState> {
  return new Plugin<CommentHighlightState>({
    key: commentHighlightPluginKey,
    state: {
      init(_config, state) {
        return computeState(options.ydoc, state, options.getActiveThreadId());
      },
      apply(tr, prev, _oldState, newState) {
        const refreshRequested = tr.getMeta(REFRESH_META) === true;
        if (!tr.docChanged && !refreshRequested) return prev;
        return computeState(options.ydoc, newState, options.getActiveThreadId());
      },
    },
    props: {
      decorations(state) {
        return commentHighlightPluginKey.getState(state)?.decorations;
      },
      handleClick(view, pos) {
        const pluginState = commentHighlightPluginKey.getState(view.state);
        if (!pluginState) return false;
        const found = pluginState.decorations.find(pos, pos);
        const threadId = (found[0]?.spec as { threadId?: string } | undefined)?.threadId;
        if (!threadId) return false;
        options.onActivate(threadId);
        return false; // don't swallow the click; still places the caret normally
      },
    },
  });
}
