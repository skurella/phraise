// Workaround 3 of 3 for stack 13's binding loss (see src/yjs.ts header), and
// brief 05's gate D/E finding: @tiptap/y-tiptap 3.0.9's `restoreRelativeSelection`
// (dist/y-tiptap.js) resolves a plain text selection's anchor/head from the
// Yjs relative position (`relativePositionToAbsolutePosition`, exactly what
// upstream y-prosemirror does) and then, ONLY for the default ("text")
// selection type, passes each endpoint through `recoverSelectionEndpoint` ->
// `isMisresolvedAfterStructuralChange`. That heuristic was added in 3.0.6/
// 3.0.7 to rescue a selection whose anchor node was structurally MOVED (e.g.
// a drag-and-drop block reorder): it compares the old and new paragraph's
// `textContent` around the resolved offset, and if the surrounding text
// looks different, discards the (correct) Yjs-resolved position and
// "recovers" a position by walking the OLD document instead
// (`findAbsolutePositionAfterStructuralChange`).
//
// That comparison also fires for the ordinary, non-drag-and-drop case this
// spike actually has: a remote user's edit changes the textContent of the
// SAME paragraph a local, idle caret sits in (e.g. typing before it), with
// no structural move at all. The heuristic then "recovers" the caret back
// to its old absolute offset inside the OLD document -- which, after the
// remote insertion shifted everything after it, is now a *different*
// logical position (typically a few characters into the following word).
// Confirmed directly (see `test/localCaretFollow.spec.ts` and the builder
// log for brief 05): with only `ySyncPlugin`, a local user's idle caret
// mid-paragraph does NOT follow a remote insertion earlier in that same
// paragraph; `relativePositionToAbsolutePosition` alone (no heuristic)
// resolves it correctly.
//
// Fix, without patching node_modules or changing the pinned version: an
// `appendTransaction` plugin that, for the exact transaction
// `ProsemirrorBinding._typeChanged` dispatches for a remote change (or a
// local undo/redo -- both go through the same code path; see the file
// comment continuation below), recomputes the LOCAL selection purely from
// `binding.beforeTransactionSelection`'s relative anchor/head via
// `relativePositionToAbsolutePosition` -- the same inputs
// `restoreRelativeSelection` already computed before running them through
// the heuristic -- and overrides the transaction's selection with that.
// Only the plain "text" selection type is touched; `node`/`nodeRange`/`all`
// selections are left exactly as the binding resolved them (brief's
// instruction: those types don't go through `recoverSelectionEndpoint` at
// all, so they are not affected by this bug and this plugin does nothing
// for them).
//
// Why local undo/redo also goes through `_typeChanged` (confirmed by
// reading y-tiptap's source, not assumed): a local user's OWN prosemirror
// transaction updates Yjs via `_prosemirrorChanged`, called inside
// `this.mux(...)`; the resulting Yjs change then re-enters `_typeChanged`
// (the fragment's deep observer) inside the SAME mutex call, so its body is
// skipped for that echo. Undo/redo instead call `UndoManager.undo()/redo()`
// directly on the Yjs doc -- NOT wrapped in the binding's mutex -- so
// `_typeChanged`'s full body (rebuild doc, `restoreRelativeSelection`,
// dispatch) runs for those too, with `isUndoRedoOperation: true`. For undo/
// redo, `yUndoPlugin`'s `stack-item-popped` handler has already set
// `binding.beforeTransactionSelection` to the EXACT relative selection
// captured when that undo group was recorded (see y-tiptap.js's
// `yUndoPlugin.view()`), so resolving it purely via
// `relativePositionToAbsolutePosition` is also correct there (undo/redo
// replays an exact structural inverse; the position it points at is exactly
// where it was when captured) -- confirmed by gate E staying green with
// this plugin active (see the builder log).
//
// Plugin order: this plugin must run in `PhraiseWorkarounds`'s
// `addProseMirrorPlugins()` list AFTER `leafMarksPlugin` and
// `rootAttrsPlugin` (see `tiptapWorkaroundsExtension.ts`'s own comment for
// why leafMarks must precede rootAttrs). Both of those replace nodes via
// `setNodeMarkup`/`setNodeAttribute`, which never change a node's size, so
// they never shift the position this plugin computes -- ordering relative
// to them is not a correctness requirement, only a documented convention
// ("workarounds run in a fixed, tested order"). See
// `test/workaroundOrder.spec.ts` for the enforced order.
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { ySyncPluginKey, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';

export const localCaretFollowPluginKey = new PluginKey('localCaretFollow');

export interface LocalCaretFollowStats {
  /** Number of times this plugin overrode the binding's resolved selection. */
  corrections: number;
}

/** The shape `getRelativeSelection` (y-tiptap.js) returns, and
 * `ProsemirrorBinding.beforeTransactionSelection` carries between the start
 * of a Yjs transaction and the dispatch `_typeChanged` produces for it. */
interface RelativeSelection {
  type: string;
  anchor: unknown;
  head: unknown;
}

function isRemoteOrUndoChange(trs: readonly Transaction[]): boolean {
  return trs.some((tr) => {
    const meta = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
    return !!meta?.isChangeOrigin;
  });
}

/** Local-caret-follow workaround: after a remote edit (or local undo/redo)
 * touches the same fragment, override the plain text selection y-tiptap
 * resolved with one computed purely from the Yjs relative position, instead
 * of the version `recoverSelectionEndpoint`'s structural-move heuristic may
 * have misresolved. Returns `null` (no-op) whenever there is nothing to
 * correct, so this plugin is inert for every transaction it doesn't apply
 * to and for a scenario where the heuristic's answer already agreed. */
export function localCaretFollowPlugin(stats: LocalCaretFollowStats = { corrections: 0 }): Plugin {
  return new Plugin({
    key: localCaretFollowPluginKey,
    appendTransaction(trs, _oldState: EditorState, newState: EditorState) {
      if (!isRemoteOrUndoChange(trs)) return null;

      const syncState = ySyncPluginKey.getState(newState) as { binding?: unknown } | undefined;
      const binding = syncState?.binding as
        | { doc: unknown; type: unknown; mapping: unknown; beforeTransactionSelection: RelativeSelection | null }
        | undefined;
      if (!binding) return null;

      const relSel = binding.beforeTransactionSelection;
      // Only the plain text selection is affected by the misresolution bug
      // this plugin works around; leave node/nodeRange/all selections as
      // restoreRelativeSelection left them.
      if (!relSel || relSel.type !== 'text') return null;
      if (relSel.anchor == null || relSel.head == null) return null;

      const anchor = relativePositionToAbsolutePosition(
        binding.doc as Parameters<typeof relativePositionToAbsolutePosition>[0],
        binding.type as Parameters<typeof relativePositionToAbsolutePosition>[1],
        relSel.anchor,
        binding.mapping as Parameters<typeof relativePositionToAbsolutePosition>[3],
      );
      const head = relativePositionToAbsolutePosition(
        binding.doc as Parameters<typeof relativePositionToAbsolutePosition>[0],
        binding.type as Parameters<typeof relativePositionToAbsolutePosition>[1],
        relSel.head,
        binding.mapping as Parameters<typeof relativePositionToAbsolutePosition>[3],
      );
      // Either endpoint failing to resolve (e.g. the content it pointed at
      // was deleted by the remote change) means there is nothing safe for
      // this plugin to recover; leave the binding's own answer in place.
      if (anchor == null || head == null) return null;

      const size = newState.doc.content.size;
      const clampedAnchor = Math.min(Math.max(anchor, 0), size);
      const clampedHead = Math.min(Math.max(head, 0), size);
      const wanted = TextSelection.between(newState.doc.resolve(clampedAnchor), newState.doc.resolve(clampedHead));
      if (wanted.eq(newState.selection)) return null;

      stats.corrections++;
      return newState.tr.setSelection(wanted).setMeta('addToHistory', false);
    },
  });
}
