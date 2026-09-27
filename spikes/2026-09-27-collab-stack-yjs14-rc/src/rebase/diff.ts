// Brief 06 task 2: pmA -> pmB diff emitter, ported to Yjs 14's unified
// Y.Node representation.
//
// Stack13's diff.ts hand-rolls its own two-step diff (exact-match LCS over
// child "structural hashes", then a Dice-similarity fuzzy pairing within
// each unmatched run, then a word/char/block text diff inside paired
// textblocks) and emits Y.XmlElement/Y.XmlText operations directly.
//
// That whole approach turned out to be unnecessary here. `@y/prosemirror`'s
// OWN binding calls a function -- `pmDocDiff` (`rdt/prosemirror.js`'s
// `pull()`, invoked on every keystroke) -- that already does exactly this
// job: a structural diff (prefix/suffix trim by node identity, then a
// single-paired-child fast path, then a windowed diff) using `@y/prosemirror`'s
// own `nodeToDelta`/`marksToFormattingAttributes` encoding for every node and
// mark, so whatever it emits is BY CONSTRUCTION what the binding itself
// would write.
//
// `pmDocDiff` itself is not part of `@y/prosemirror`'s public API (its
// `package.json` "exports" field only allows the package root, and the
// function is not re-exported from `index.js`) -- confirmed by reading both
// before relying on either. Per the brief's own named fallback ("apply
// delta.diff of the fork's current delta against pmnodeToDelta(pmB)"), this
// file instead calls `lib0/delta`'s own `diff()` (public) on the two
// documents' canonical `docToDelta` snapshots directly. Reading
// `lib0/delta/delta.js`'s `diff`/`applyChangesetToDelta` confirms this is
// NOT a cruder substitute: `diff()` already recurses into matched children
// via `modify` on its own, and aligns text at line, then WORD
// (`patience.smartSplitRegex`), then character granularity -- the exact
// same granularity spike 2's own hand-rolled word-level diff targeted, and
// the exact same `delta.diff` call `pmNodeDiff` itself delegates to for
// every window that isn't a single unchanged-attrs paired child. The only
// difference from `pmDocDiff` is performance (a whole-document diff every
// time, vs an incremental changed-window walk) and, per lib0's own
// contract, possibly a different (but always convergent) op split in rare
// ambiguous windows -- irrelevant at this spike's scale.
//
// So: the brief's "preferred" (word-level, per-block, binding-shaped) and
// "fallback" (delta.diff against pmnodeToDelta(pmB)) approaches collapse
// into ONE implementation once `pmDocDiff`'s private wrapper is
// unavailable. Verified empirically in scratch/probe-rebase-primitives.ts
// before writing this file: applying the resulting change to a fork via
// `ytype.applyDelta(change)` makes the fork read back (`ynodeToPmnode`)
// exactly equal to the target document.
import { docToDelta } from "@y/prosemirror";
import * as delta from "lib0/delta";
import type { Node as PMNode } from "prosemirror-model";

/**
 * Diff pmA -> pmB and apply the result to `ytype` (the fork's root Y.Node)
 * in place, so that afterwards its content equals pmB exactly. `pmA` must
 * be the PM-equivalent of `ytype`'s current content (the caller derives it
 * with `docToPM`, so the diff always starts from the CRDT's actual state,
 * not a possibly-stale copy) -- same contract as stack13's `applyTreeDiff`.
 */
export function applyTreeDiff(ytype: any, pmA: PMNode, pmB: PMNode): void {
  const change = delta.diff(docToDelta(pmA as any) as any, docToDelta(pmB as any) as any);
  ytype.applyDelta(change);
}
