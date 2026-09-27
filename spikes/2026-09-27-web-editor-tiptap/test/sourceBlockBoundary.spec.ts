// Brief 03, task 3/7 (unit test for the source-block boundary logic).
import { describe, expect, it } from 'vitest';
import { Node as PMNode } from 'prosemirror-model';
import { schema } from '../src/model/schema.js';
import {
  rawBlockBeforeCursorAtStart,
  rawBlockAfterCursorAtEnd,
  exitPositionAfterCodeNode,
  isOnLastLineOfCodeNode,
} from '../src/editing/sourceBlockBoundary.js';

function para(text: string) {
  return schema.node('paragraph', {}, text ? [schema.text(text)] : []);
}

function rawBlock(kind: string, text: string) {
  return schema.node('raw_block', { kind }, text ? [schema.text(text)] : []);
}

/** Top-level start position (the position right before) of `doc`'s child at `index`. */
function topLevelStart(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

describe('rawBlockBeforeCursorAtStart', () => {
  it('finds the raw_block position when the cursor is at the start of the paragraph right after it', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [rawBlock('html', '<div>x</div>'), para('after text')]);
    const paraStart = topLevelStart(doc, 1);
    const $from = doc.resolve(paraStart + 1); // start of the paragraph's own content
    expect($from.parent.type.name).toBe('paragraph');
    expect($from.parentOffset).toBe(0);
    const found = rawBlockBeforeCursorAtStart($from);
    expect(found).toBe(0);
    expect(doc.nodeAt(found!)?.type.name).toBe('raw_block');
  });

  it('returns null when the cursor is not at the very start', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [rawBlock('html', '<div>x</div>'), para('after text')]);
    const paraStart = topLevelStart(doc, 1);
    const $from = doc.resolve(paraStart + 2); // offset 1 in the paragraph
    expect(rawBlockBeforeCursorAtStart($from)).toBeNull();
  });

  it('returns null when the previous top-level block is not a raw_block', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('before'), para('after')]);
    const paraStart = topLevelStart(doc, 1);
    const $from = doc.resolve(paraStart + 1);
    expect(rawBlockBeforeCursorAtStart($from)).toBeNull();
  });

  it('returns null when the cursor is inside the raw_block itself', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [rawBlock('html', '<div>x</div>')]);
    const $from = doc.resolve(1); // start of the raw_block's own text
    expect(rawBlockBeforeCursorAtStart($from)).toBeNull();
  });
});

describe('rawBlockAfterCursorAtEnd', () => {
  it('finds the raw_block position when the cursor is at the end of the paragraph right before it', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('before text'), rawBlock('html', '<div>x</div>')]);
    const $from = doc.resolve(1 + 'before text'.length); // end of first paragraph's content
    expect($from.parentOffset).toBe($from.parent.content.size);
    const found = rawBlockAfterCursorAtEnd($from);
    expect(found).toBe(topLevelStart(doc, 1));
    expect(doc.nodeAt(found!)?.type.name).toBe('raw_block');
  });

  it('returns null when the cursor is not at the very end', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('before text'), rawBlock('html', '<div>x</div>')]);
    const $from = doc.resolve(1 + 3);
    expect(rawBlockAfterCursorAtEnd($from)).toBeNull();
  });

  it('returns null when the next top-level block is not a raw_block', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('before'), para('after')]);
    const $from = doc.resolve(1 + 'before'.length);
    expect(rawBlockAfterCursorAtEnd($from)).toBeNull();
  });
});

describe('exitPositionAfterCodeNode / isOnLastLineOfCodeNode', () => {
  it('returns the existing next block content start when one follows', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [rawBlock('html', 'line one\nline two'), para('after')]);
    const $from = doc.resolve(1 + 'line one\nline two'.length);
    expect(isOnLastLineOfCodeNode($from)).toBe(true);
    const exit = exitPositionAfterCodeNode($from);
    const paraStart = topLevelStart(doc, 1);
    expect(exit).toEqual({ existingBlockContentStart: paraStart + 1 });
  });

  it('returns insertAt when the code node is the last block', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [rawBlock('html', 'only line')]);
    const $from = doc.resolve(1 + 'only line'.length);
    const exit = exitPositionAfterCodeNode($from);
    expect(exit).toEqual({ insertAt: doc.child(0).nodeSize });
  });

  it('isOnLastLineOfCodeNode is false when the cursor is on an earlier line', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [rawBlock('html', 'line one\nline two')]);
    const $from = doc.resolve(1 + 3); // inside "line one"
    expect(isOnLastLineOfCodeNode($from)).toBe(false);
  });

  it('returns null for a non-code textblock', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('hello')]);
    const $from = doc.resolve(1 + 'hello'.length);
    expect(exitPositionAfterCodeNode($from)).toBeNull();
    expect(isOnLastLineOfCodeNode($from)).toBe(false);
  });
});
