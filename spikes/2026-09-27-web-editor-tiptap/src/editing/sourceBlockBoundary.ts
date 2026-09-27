// Brief 03, task 3: "No corruption around source blocks." Pure
// position-and-node arithmetic (no ProseMirror commands dispatched here;
// `web/src/editing/sourceBlockKeymap.ts` wires these into real keyboard
// shortcuts) so the boundary-detection logic is unit-testable without a
// live EditorView.
//
// Why this needs its own code at all (see this brief's log for the
// confirmation): `raw_block` has `content: 'text*'` with no block content,
// which makes it a real ProseMirror "textblock" -- exactly like `paragraph`
// -- so the DEFAULT Backspace/Delete chains (`joinBackward`/`joinForward`,
// last in Tiptap core's own Keymap extension) would happily merge a
// neighbouring paragraph's text directly into a source block's own text
// content, corrupting it. Google Docs' own answer to "Backspace/Delete at
// a media boundary" is to select the block first (a second press then
// deletes it); this file finds the position for that NodeSelection.
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';

/**
 * If the cursor is at the very start of its (non-source-block) textblock and
 * the top-level node immediately before it is a `raw_block`, return that
 * `raw_block`'s own start position (for a `NodeSelection`). Otherwise `null`
 * -- including when the cursor's own parent already IS a `raw_block` (its
 * own internal Backspace-at-start is not this gesture; nothing before it at
 * the top level needs protecting from a join in that case, and normal
 * caret-only Backspace behaviour inside the source text should proceed).
 */
export function rawBlockBeforeCursorAtStart($from: ResolvedPos): number | null {
  if ($from.parentOffset !== 0) return null;
  // Only a top-level textblock's own boundary: `src`/`gap` (and this
  // corruption risk) are a top-level-only concept per D4's amendments.
  if ($from.depth !== 1) return null;
  if ($from.parent.type.name === 'raw_block') return null;
  const before = $from.before(1);
  const prev = $from.doc.resolve(before).nodeBefore;
  if (prev && prev.type.name === 'raw_block') {
    return before - prev.nodeSize;
  }
  return null;
}

/**
 * Mirror of `rawBlockBeforeCursorAtStart` for Delete: the cursor is at the
 * very end of its textblock and the top-level node immediately after it is
 * a `raw_block`.
 */
export function rawBlockAfterCursorAtEnd($from: ResolvedPos): number | null {
  if ($from.parentOffset !== $from.parent.content.size) return null;
  if ($from.depth !== 1) return null;
  if ($from.parent.type.name === 'raw_block') return null;
  const after = $from.after(1);
  const next = $from.doc.resolve(after).nodeAfter;
  if (next && next.type.name === 'raw_block') {
    return after;
  }
  return null;
}

/**
 * Brief 03, task 3: "Enter at the end of a source block's source adds a
 * line inside it; a way out (ArrowDown at the end, or Mod-Enter) moves to a
 * new paragraph after it." Enter itself needs no code (any `code: true`
 * node already gets a plain newline for free from Tiptap core's own
 * `newlineInCode` -- confirmed in this brief's log). This computes where
 * "a way out" lands: if a block already follows the code node, its own
 * start-of-content position; otherwise `null` to signal "insert a fresh
 * paragraph after it and land there" (the caller creates that paragraph,
 * since this module has no schema access of its own to build one).
 */
export function exitPositionAfterCodeNode($from: ResolvedPos): { existingBlockContentStart: number } | { insertAt: number } | null {
  if (!$from.parent.type.spec.code) return null;
  const after = $from.after();
  const $after = $from.doc.resolve(after);
  if ($after.nodeAfter) {
    return { existingBlockContentStart: after + 1 };
  }
  return { insertAt: after };
}

/** True if the cursor is on the last physical line of its (code) textblock's
 * own text -- the condition for "ArrowDown at the end" to mean "leave the
 * block" rather than "move to the next line within it". */
export function isOnLastLineOfCodeNode($from: ResolvedPos): boolean {
  if (!$from.parent.type.spec.code) return false;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  const lastLineStart = text.lastIndexOf('\n') + 1;
  return offset >= lastLineStart;
}

/** True if `node` is a source-ish block whose neighbours' Backspace/Delete
 * must not join into it (currently just `raw_block`; `code_block` already
 * behaves safely with plain joins, since a code_block <-> paragraph join is
 * an intentional, well-understood gesture elsewhere in this app). */
export function isProtectedSourceBlock(node: PMNode): boolean {
  return node.type.name === 'raw_block';
}
