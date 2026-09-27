// Brief 04 task 2: "Port gates/lib/edits.ts as src/testkit/edits.ts."
// Origin: spike 5 (collab-stack-yjs13-hocuspocus, branch
// spike/2026-09-27-collab-stack, commit eeb3fe2, gates/lib/edits.ts).
// Every edit is a genuine ProseMirror `Transaction` dispatched on a live
// `EditorView` (never a raw Yjs write), so the live sync plugin -- and,
// through `crdt.editorPlugins`, the workaround plugins -- see it exactly as
// a real user would produce it. `addCommentOnQuote` is new here: the
// engine's comment store operates on the `CrdtDoc` directly (comments are
// not ProseMirror nodes), so it goes through `engine.createCommentOnQuote`
// rather than a dispatched transaction.
import type { EditorView } from 'prosemirror-view';
import { splitBlock, joinBackward } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { Slice, type Node as PMNode } from 'prosemirror-model';
import { createCommentOnQuote, type CommentAuthor } from '../engine/index.js';
import type { CrdtDoc } from '../crdt/index.js';

/** Type `text` into `view` at `pos`, one character per transaction (so each keystroke is its own Yjs update, matching real typing). Returns the end position. */
export function insertText(view: EditorView, pos: number, text: string): number {
  let at = pos;
  for (const ch of text) {
    view.dispatch(view.state.tr.insertText(ch, at));
    at += ch.length;
  }
  return at;
}

/** Replace the text in `[from, to)` with `replacement`, as one transaction (a single-word "retype" edit, not per-character). */
export function replaceWord(view: EditorView, from: number, to: number, replacement: string): void {
  view.dispatch(view.state.tr.insertText(replacement, from, to));
}

/** Place the selection at `pos` and run prosemirror-commands' `splitBlock`. */
export function splitBlockAt(view: EditorView, pos: number): boolean {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
  view.dispatch(tr);
  return splitBlock(view.state, view.dispatch, view);
}

/** Place the selection at `pos` and run prosemirror-commands' `joinBackward`. */
export function joinBackwardAt(view: EditorView, pos: number): boolean {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
  view.dispatch(tr);
  return joinBackward(view.state, view.dispatch, view);
}

/** Delete the range `[from, to)`. */
export function deleteRange(view: EditorView, from: number, to: number): void {
  view.dispatch(view.state.tr.delete(from, to));
}

/** Find the first position `pred(node, pos)` matches, descending the whole doc. */
export function findPos(view: EditorView, pred: (node: PMNode, pos: number) => boolean): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (pred(node, pos)) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** A single transaction that replaces the whole document's content and every doc attr, dispatched through the real `EditorView` (so the live sync plugin -- and the workaround plugins -- see it as an ordinary local edit). */
export function replaceWholeDoc(view: EditorView, newDoc: PMNode): void {
  let tr = view.state.tr;
  tr = tr.replace(0, view.state.doc.content.size, new Slice(newDoc.content, 0, 0));
  for (const [key, value] of Object.entries(newDoc.attrs)) {
    tr = tr.setDocAttribute(key, value);
  }
  view.dispatch(tr);
}

/** New for this brief: anchor a comment on the `occurrence`-th (default 0) exact occurrence of `quote` in the live document's current plain text, through `engine.createCommentOnQuote` -- comments are engine/crdt state, not ProseMirror nodes, so there is no transaction to dispatch. */
export function addCommentOnQuote(doc: CrdtDoc, quote: string, body: string, author: CommentAuthor, occurrence = 0): string {
  return createCommentOnQuote(doc, quote, { body, author, occurrence });
}
