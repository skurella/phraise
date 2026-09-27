// RemoteEditor (plan section 5): stands in for a browser editor driving a
// Y.Doc directly. Reads the doc with `yDocToDoc`, builds the edited
// ProseMirror doc with plain tree-replace operations (`Node.replace`), and
// writes it back with `updateYFragment` after `encodeLeafMarks`, exactly as
// `ySyncPlugin` does on every local transaction. No network, no
// HocuspocusProvider here: brief 01 is the pure core, tests exchange
// updates between `Y.Doc`s directly with `Y.applyUpdate`.
import * as Y from 'yjs';
import { updateYFragment } from 'y-prosemirror';
import { Node as PMNode, Fragment, Slice } from 'prosemirror-model';
import { yDocToDoc, encodeLeafMarks, schema } from '../md/index.js';
import { FRAGMENT_NAME, META_MAP_NAME } from '../md/yjs.js';

interface BlockAt {
  node: PMNode;
  pos: number;
}

export class RemoteEditor {
  constructor(private readonly ydoc: Y.Doc) {}

  /** The document as the remote editor currently sees it. */
  currentDoc(): PMNode {
    return yDocToDoc(this.ydoc);
  }

  private commit(newDoc: PMNode): void {
    const encoded = encodeLeafMarks(newDoc);
    this.ydoc.transact(() => {
      const fragment = this.ydoc.getXmlFragment(FRAGMENT_NAME);
      updateYFragment(this.ydoc, fragment, encoded, { mapping: new Map(), isOMark: new Map() } as any);
      const meta = this.ydoc.getMap(META_MAP_NAME);
      meta.set('lead', encoded.attrs.lead ?? '');
      meta.set('eol', encoded.attrs.eol ?? '\n');
    });
  }

  private topLevelBlock(doc: PMNode, index: number): BlockAt {
    let result: BlockAt | undefined;
    doc.forEach((node, offset, i) => {
      if (i === index) result = { node, pos: offset };
    });
    if (!result) throw new Error(`RemoteEditor: no top-level block at index ${index}`);
    return result;
  }

  /**
   * Replace the wordIndex-th word (0-based, `/\S+/` tokens over
   * `textContent`) of the paragraphIndex-th `paragraph` node (document
   * order, any depth) with `newWord`. `newWord === ''` deletes the word,
   * also collapsing one adjacent space so the result doesn't double up.
   */
  replaceWord(paragraphIndex: number, wordIndex: number, newWord: string): void {
    const doc = this.currentDoc();
    let count = 0;
    let target: BlockAt | undefined;
    doc.descendants((node, pos) => {
      if (target) return false;
      if (node.type.name === 'paragraph') {
        if (count === paragraphIndex) {
          target = { node, pos };
          return false;
        }
        count++;
      }
      return true;
    });
    if (!target) throw new Error(`RemoteEditor.replaceWord: no paragraph at index ${paragraphIndex}`);
    const { node, pos } = target;
    const text = node.textContent;
    const words = [...text.matchAll(/\S+/g)];
    const w = words[wordIndex];
    if (!w) {
      throw new Error(
        `RemoteEditor.replaceWord: no word ${wordIndex} in paragraph ${paragraphIndex} (text: ${JSON.stringify(text)})`,
      );
    }
    let start = w.index as number;
    let end = start + w[0].length;
    if (newWord === '') {
      if (text[end] === ' ') end += 1;
      else if (text[start - 1] === ' ') start -= 1;
    }
    const from = pos + 1 + start;
    const to = pos + 1 + end;
    const slice = newWord === '' ? Slice.empty : new Slice(Fragment.from(schema.text(newWord)), 0, 0);
    this.commit(doc.replace(from, to, slice));
  }

  /** Insert a new paragraph containing `text` right after the blockIndex-th top-level block. */
  insertParagraphAfter(blockIndex: number, text: string): void {
    const doc = this.currentDoc();
    const { node, pos } = this.topLevelBlock(doc, blockIndex);
    const insertPos = pos + node.nodeSize;
    const para = schema.node('paragraph', null, text.length > 0 ? [schema.text(text)] : []);
    this.commit(doc.replace(insertPos, insertPos, new Slice(Fragment.from(para), 0, 0)));
  }

  /** Delete the blockIndex-th top-level block entirely. */
  deleteBlock(blockIndex: number): void {
    const doc = this.currentDoc();
    const { node, pos } = this.topLevelBlock(doc, blockIndex);
    this.commit(doc.replace(pos, pos + node.nodeSize, Slice.empty));
  }

  /**
   * Insert `text` at a character offset within the blockIndex-th top-level
   * textblock's `textContent` (inline leaves like image/hard_break count as
   * 0 characters; an offset exactly at a leaf inserts immediately before
   * it).
   */
  insertTextAt(blockIndex: number, charOffset: number, text: string): void {
    const doc = this.currentDoc();
    const { node, pos } = this.topLevelBlock(doc, blockIndex);
    let textPos = 0;
    let cursor = pos + 1;
    let result: number | undefined;
    node.forEach((child) => {
      if (result !== undefined) return;
      if (child.isText) {
        const len = (child.text ?? '').length;
        if (charOffset <= textPos + len) {
          result = cursor + (charOffset - textPos);
          return;
        }
        textPos += len;
        cursor += child.nodeSize;
      } else {
        if (charOffset === textPos) {
          result = cursor;
          return;
        }
        cursor += child.nodeSize;
      }
    });
    if (result === undefined) result = cursor;
    this.commit(doc.replace(result, result, new Slice(Fragment.from(schema.text(text)), 0, 0)));
  }
}
