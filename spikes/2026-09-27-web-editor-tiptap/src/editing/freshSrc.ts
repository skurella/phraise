// Brief 02, task 1: "A top-level block created by Enter, by splitting or by
// an input rule must not inherit another block's `src` and `gap`."
//
// Why a plugin instead of overriding the Enter command: `prosemirror-commands`'
// `splitBlockAs()`/`splitBlock` (the default Tiptap core Enter binding, tried
// after any more specific extension declines the key) calls
// `prosemirror-transform`'s `split()`, which -- confirmed by reading its
// source -- builds BOTH resulting nodes via `$pos.node(d).copy(after)` when no
// explicit `typesAfter` override is given: `Node.copy()` keeps the same type
// AND attrs, only replacing content. So a plain Enter at the top level
// produces two nodes that both carry the ORIGINAL block's `src`/`gap`. A
// custom `splitNode` callback could fix this for plain Enter, but would not
// cover every other command that can split a top-level block (`splitBlock`
// variants, chained commands, remote collaborative edits replayed as
// transactions) -- and per the brief, an input rule already resets `src`/
// `gap` on its own (`setBlockType`/`tr.wrap` build fresh node instances via
// `type.create(attrs)`, which defaults any attr not in `attrs` to the
// schema's own default -- confirmed by reading `setNodeMarkup`'s source). So
// the one thing that needs fixing generically is exactly this "step is a
// pure split at the top level" shape, which this plugin detects directly from
// the transaction's own steps rather than guessing which command ran.
//
// Detection: a "pure split" is a `ReplaceStep` with `from === to` (nothing
// deleted, matching a plain `Transform.split()` call) whose slice is
// symmetrically open (`openStart === openEnd`) by exactly one level, AND
// whose split position resolves to depth 1 in the pre-step document (i.e. the
// node being split is itself a direct child of `doc`, not nested in a list
// item/blockquote/table cell -- those nested nodes' `src`/`gap` are already
// always null per `src/model/schema.ts`, so splitting them needs no fix).
// Matching on step shape (not on which command produced it) is what makes
// this safe to run for every transaction, including ones from remote
// collaborators via Yjs: the invariant it enforces ("a genuinely new
// top-level block has no src") holds regardless of who typed Enter.
//
// Deliberately narrow: a `ReplaceStep` with `from !== to` (typing over a
// selection, list operations that first delete a range) is never touched
// here, so seeded/pasted content's real, meaningful `src` values are left
// alone -- only whichever half of a genuine split at the top level is "new"
// gets its `src` nulled. The "surviving" (first) half keeps its `src`
// unchanged, matching "a block joined into another keeps the surviving
// block's src".
//
// This same step shape, though, is not unique to Enter: pasting rich
// content at a caret inside an existing top-level block (a real paste, or
// ProseMirror's own default paste-fitting for HTML) produces the identical
// `from === to`, symmetrically-open-by-one split shape -- confirmed by
// dumping the real step JSON for a paste into the middle of a paragraph
// (see the builder log). Found there: the SURVIVING ("before") half's
// `gap` can be stale in exactly this case. `gap` describes the separator
// to whatever comes AFTER this block; if this block used to be the last
// block in its FILE (so its `gap` is the file's trailing bytes, e.g. `'\n'`
// or `''`) and new content is now inserted right after it, that `gap`
// value is simply wrong for its new position, and `serializeDoc` would
// emit it verbatim (gluing the new content on with no blank line, or with
// only the file's old trailing newline). Nulling the survivor's `gap`
// (never its `src` -- the text up to the split point is unchanged and
// still verifies against it) lets `serializeDoc`'s own default-separator
// fallback take over, exactly as every other "genuinely new neighbour"
// case in this file already relies on. This is safe for the plain
// Enter-split case too: when the original `gap` already matched the
// file's own default convention (the overwhelmingly common case, and the
// only shape a split-then-immediate-join round-trip test exercises),
// nulling it and re-deriving the default produces byte-identical output.
import { Plugin, PluginKey } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import type { Transaction } from 'prosemirror-state';
import { Extension } from '@tiptap/core';

export const freshSrcPluginKey = new PluginKey('freshSrc');

interface SplitPositions {
  /** The surviving ("before") top-level node's own start boundary: only its
   * `gap` needs invalidating (see the file comment). */
  beforePos: number;
  /** The newly created ("after") top-level node's own start boundary: both
   * `src` and `gap` need invalidating. */
  afterPos: number;
}

/** Positions (in the final document of a batch of transactions) of the two
 * top-level blocks either side of a pure top-level split step. */
function findTopLevelSplitPositions(transactions: readonly Transaction[]): SplitPositions[] {
  const results: SplitPositions[] = [];
  for (let ti = 0; ti < transactions.length; ti++) {
    const transaction = transactions[ti];
    if (!transaction.docChanged) continue;
    for (let i = 0; i < transaction.steps.length; i++) {
      const step = transaction.steps[i];
      if (!(step instanceof ReplaceStep)) continue;
      if (step.from !== step.to) continue; // only a pure split: nothing deleted
      const { slice } = step;
      if (slice.openStart < 1 || slice.openStart !== slice.openEnd) continue;

      const beforeDoc = transaction.docs[i];
      let $split;
      try {
        $split = beforeDoc.resolve(step.from);
      } catch {
        continue;
      }
      // Only a single-level split exactly at the top level (the split node is
      // a direct child of doc): nested splits leave already-null attrs alone.
      if ($split.depth !== 1 || slice.openStart !== 1) continue;

      // The surviving ("before") node's own start boundary is unaffected by
      // this step (nothing before the split point moved).
      let beforePos = $split.before(1);
      // Position right after this step's own effect: the start boundary of
      // the newly created "after" (second) top-level node. A symmetric
      // split of depth D inserts exactly D closing tokens followed by D
      // opening tokens at `step.from`; the boundary between them -- an
      // interior position of that insertion, which `StepMap.map()` cannot
      // return directly -- is `step.from + D`.
      let afterPos = step.from + slice.openStart;
      for (let j = i + 1; j < transaction.steps.length; j++) {
        beforePos = transaction.steps[j].getMap().map(beforePos, -1);
        afterPos = transaction.steps[j].getMap().map(afterPos, 1);
      }
      for (let tj = ti + 1; tj < transactions.length; tj++) {
        beforePos = transactions[tj].mapping.map(beforePos, -1);
        afterPos = transactions[tj].mapping.map(afterPos, 1);
      }
      results.push({ beforePos, afterPos });
    }
  }
  return results;
}

export function freshSrcPlugin(): Plugin {
  return new Plugin({
    key: freshSrcPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      const splits = findTopLevelSplitPositions(transactions);
      if (splits.length === 0) return null;

      const tr = newState.tr;
      let changed = false;
      for (const { beforePos, afterPos } of splits) {
        const before = tr.doc.nodeAt(tr.mapping.map(beforePos, -1));
        if (before && before.attrs.gap != null) {
          tr.setNodeMarkup(tr.mapping.map(beforePos, -1), undefined, { ...before.attrs, gap: null });
          changed = true;
        }
        const after = tr.doc.nodeAt(tr.mapping.map(afterPos, 1));
        if (after && (after.attrs.src != null || after.attrs.gap != null)) {
          tr.setNodeMarkup(tr.mapping.map(afterPos, 1), undefined, { ...after.attrs, src: null, gap: null });
          changed = true;
        }
      }
      return changed ? tr : null;
    },
  });
}

/** Tiptap wrapper, matching the convention in
 * `src/collab/tiptapWorkaroundsExtension.ts` (a thin Extension around a plain
 * ProseMirror plugin). Adds no node/mark, so it does not affect
 * `checkSchemaEquivalence`. */
export const FreshSrc = Extension.create({
  name: 'freshSrc',
  addProseMirrorPlugins() {
    return [freshSrcPlugin()];
  },
});
