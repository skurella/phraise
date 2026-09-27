// Shared real-ProseMirror editing helpers for the gates: every edit is a
// genuine Transaction dispatched on a live EditorView, per the plan's gate
// B script ("Use view.pasteHTML for paste, prosemirror-commands splitBlock
// and joinBackward for split and join, and insertText transactions one
// character at a time for typing").
import type { EditorView } from 'prosemirror-view';
import { splitBlock, joinBackward } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { Slice, type Node as PMNode } from 'prosemirror-model';

/** Type `text` into `view` at `pos`, one character per transaction. Returns the end position. */
export function insertText(view: EditorView, pos: number, text: string): number {
  let at = pos;
  for (const ch of text) {
    view.dispatch(view.state.tr.insertText(ch, at));
    at += ch.length;
  }
  return at;
}

/**
 * Place the selection at `pos` and paste `html` there via the real paste
 * pipeline (`EditorView.pasteHTML`). jsdom has no `ClipboardEvent`
 * constructor, which `pasteHTML` otherwise falls back to (`event ||
 * new ClipboardEvent("paste")`); passing a dummy event sidesteps that --
 * `doPaste` only forwards it to a `handlePaste` prop, which this schema
 * never defines.
 */
export function pasteHTMLAt(view: EditorView, pos: number, html: string): void {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
  view.dispatch(tr);
  view.pasteHTML(html, {} as unknown as ClipboardEvent);
}

/** Place the selection at `pos` and run prosemirror-commands' splitBlock. */
export function splitBlockAt(view: EditorView, pos: number): boolean {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
  view.dispatch(tr);
  return splitBlock(view.state, view.dispatch, view);
}

/** Place the selection at `pos` and run prosemirror-commands' joinBackward. */
export function joinBackwardAt(view: EditorView, pos: number): boolean {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
  view.dispatch(tr);
  return joinBackward(view.state, view.dispatch, view);
}

/** Add `mark` to the leaf node at `pos` (a single-node-sized range). */
export function addMarkAt(view: EditorView, pos: number, mark: import('prosemirror-model').Mark): void {
  view.dispatch(view.state.tr.addMark(pos, pos + 1, mark));
}

/** Delete the range [from, to). */
export function deleteRange(view: EditorView, from: number, to: number): void {
  view.dispatch(view.state.tr.delete(from, to));
}

/** Find the first position `pred(node, pos)` matches, descending the whole doc. */
export function findPos(view: EditorView, pred: (node: import('prosemirror-model').Node, pos: number) => boolean): number {
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

export { waitUntil } from '../../src/client-hocuspocus.js';

/**
 * Gate C path (b): "loaded client-side into editor 1 through a transaction
 * that replaces the document and sets its attrs, so the live ySyncPlugin
 * path writes the Yjs doc". A single Transaction that replaces the whole
 * document's content and every doc attr, dispatched through the real
 * EditorView (so the live sync plugin -- and, with workarounds on, the two
 * workaround plugins -- see it as an ordinary local edit).
 */
export function replaceWholeDoc(view: EditorView, newDoc: PMNode): void {
  let tr = view.state.tr;
  tr = tr.replace(0, view.state.doc.content.size, new Slice(newDoc.content, 0, 0));
  for (const [key, value] of Object.entries(newDoc.attrs)) {
    tr = tr.setDocAttribute(key, value);
  }
  view.dispatch(tr);
}
