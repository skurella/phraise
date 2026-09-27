import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EditorState } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import { parseMarkdown, serializeDoc, semanticEq, schema, type TraceInfo } from '../src/index.js';

const HANDWRITTEN = path.resolve(import.meta.dirname, '../corpus/handwritten');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(HANDWRITTEN, name), 'utf8');
}

/** Find the PM position range of the first whole-word match of `word` in `doc`. */
function findWordPMRange(doc: PMNode, word: string): { from: number; to: number } {
  const re = new RegExp(`\\b${word}\\b`);
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.isText && node.text) {
      const m = re.exec(node.text);
      if (m) {
        result = { from: pos + m.index, to: pos + m.index + word.length };
        return false;
      }
    }
    return true;
  });
  if (!result) throw new Error(`word "${word}" not found in doc`);
  return result;
}

function findWordSourceOffset(md: string, word: string): number {
  const m = new RegExp(`\\b${word}\\b`).exec(md);
  if (!m) throw new Error(`word "${word}" not found in source`);
  return m.index;
}

const WORD_EDIT_CASES: { file: string; word: string }[] = [
  { file: 'tables.md', word: 'describing' },
  { file: 'blockquotes.md', word: 'continuation' },
  { file: 'nested-mixed-markers.md', word: 'continues' },
  { file: 'crlf.md', word: 'normal' },
  { file: 'reference-links.md', word: 'content' },
  { file: 'long-paragraphs.md', word: 'sentence' },
];

test('single word edit: replacing a word via insertText serializes to the original with just that word replaced, via splice', () => {
  for (const { file, word } of WORD_EDIT_CASES) {
    const md = readFixture(file);
    const { doc } = parseMarkdown(md);
    doc.check();

    const { from, to } = findWordPMRange(doc, word);
    const state = EditorState.create({ doc });
    const tr = state.tr.insertText('zebra', from, to);
    const newDoc = tr.doc;
    newDoc.check();

    const kinds: TraceInfo['kind'][] = [];
    const out = serializeDoc(newDoc, { trace: (info) => kinds.push(info.kind) });

    const srcOffset = findWordSourceOffset(md, word);
    const expected = md.slice(0, srcOffset) + 'zebra' + md.slice(srcOffset + word.length);

    assert.equal(out, expected, `${file}: expected exact word replacement`);
    assert.ok(kinds.includes('splice'), `${file}: expected splice path to be used, got [${kinds.join(', ')}]`);
  }
});

test('structural edit: toggling strong on a word in a list item re-parses to the edited doc, and only that block changes', () => {
  const file = 'nested-mixed-markers.md';
  const md = readFixture(file);
  const { doc } = parseMarkdown(md);
  doc.check();

  const word = 'dash';
  const { from, to } = findWordPMRange(doc, word);

  const state = EditorState.create({ doc });
  const tr = state.tr.addMark(from, to, schema.marks.strong.create());
  const newDoc = tr.doc;
  newDoc.check();

  // Confirm the mark actually landed (sanity check on the transaction itself).
  let marked = false;
  newDoc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.some((m) => m.type === schema.marks.strong)) marked = true;
  });
  assert.ok(marked, 'expected strong mark to be present after addMark');

  const out = serializeDoc(newDoc);
  const { doc: reparsed } = parseMarkdown(out);
  reparsed.check();
  assert.ok(semanticEq(reparsed, newDoc), 'serialized output must re-parse to a semantically equal doc');

  // Only the affected top-level block's bytes should differ from the original.
  // Reconstruct each original top-level block's [start, end) span in `md`.
  let offset = (doc.attrs.lead as string).length;
  const spans: [number, number][] = [];
  doc.forEach((b) => {
    const src = (b.attrs.src as string) ?? '';
    const gap = (b.attrs.gap as string) ?? '';
    spans.push([offset, offset + src.length]);
    offset += src.length + gap.length;
  });

  let firstDiff = 0;
  while (firstDiff < out.length && firstDiff < md.length && out[firstDiff] === md[firstDiff]) firstDiff++;
  let lastDiff = 0;
  while (
    lastDiff < out.length &&
    lastDiff < md.length &&
    out[out.length - 1 - lastDiff] === md[md.length - 1 - lastDiff]
  ) {
    lastDiff++;
  }
  const diffStart = firstDiff;
  const diffEnd = Math.max(out.length - lastDiff, diffStart);

  const containingBlock = spans.findIndex(([s, e]) => diffStart >= s && diffEnd <= e);
  assert.ok(
    containingBlock !== -1,
    `expected the changed byte range [${diffStart}, ${diffEnd}) to lie within a single original top-level block span; spans=${JSON.stringify(spans)}`
  );
});

test('textblock splice: bold toggle in a nested list item changes only that item line, via textblock-splice', () => {
  const file = 'nested-mixed-markers.md';
  const md = readFixture(file);
  const { doc } = parseMarkdown(md);
  doc.check();

  const word = 'dash';
  const { from, to } = findWordPMRange(doc, word);

  const state = EditorState.create({ doc });
  const tr = state.tr.addMark(from, to, schema.marks.strong.create());
  const newDoc = tr.doc;
  newDoc.check();

  const traces: TraceInfo[] = [];
  const out = serializeDoc(newDoc, { trace: (info) => traces.push(info) });

  assert.ok(traces.some((t) => t.kind === 'textblock-splice'), `expected a textblock-splice trace, got [${traces.map((t) => t.kind).join(', ')}]`);

  const { doc: reparsed } = parseMarkdown(out);
  reparsed.check();
  assert.ok(semanticEq(reparsed, newDoc), 'serialized output must re-parse to a semantically equal doc');

  // Only the single source line containing "dash" should differ; every other
  // line -- including sibling list items at every nesting depth -- stays
  // byte-identical.
  const mdLines = md.split('\n');
  const outLines = out.split('\n');
  assert.equal(outLines.length, mdLines.length, 'line count must be unchanged');
  let changedLines = 0;
  for (let i = 0; i < mdLines.length; i++) {
    if (mdLines[i] !== outLines[i]) {
      changedLines++;
      assert.ok(mdLines[i].includes('dash'), `changed line ${i} should be the "dash" line, got: ${JSON.stringify(mdLines[i])}`);
      assert.equal(outLines[i], mdLines[i].replace('dash', '**dash**'));
    }
  }
  assert.equal(changedLines, 1, 'expected exactly one changed line');
});

test('textblock splice: bold toggle in a blockquote paragraph keeps the > prefixes on every line', () => {
  const file = 'blockquotes.md';
  const md = readFixture(file);
  const { doc } = parseMarkdown(md);
  doc.check();

  const word = 'continuing';
  const { from, to } = findWordPMRange(doc, word);

  const state = EditorState.create({ doc });
  const tr = state.tr.addMark(from, to, schema.marks.strong.create());
  const newDoc = tr.doc;
  newDoc.check();

  const traces: TraceInfo[] = [];
  const out = serializeDoc(newDoc, { trace: (info) => traces.push(info) });

  assert.ok(traces.some((t) => t.kind === 'textblock-splice'), `expected a textblock-splice trace, got [${traces.map((t) => t.kind).join(', ')}]`);

  const { doc: reparsed } = parseMarkdown(out);
  reparsed.check();
  assert.ok(semanticEq(reparsed, newDoc), 'serialized output must re-parse to a semantically equal doc');

  const expected = md.replace('continuing', '**continuing**');
  assert.equal(out, expected, 'only the word itself should change; every > prefix must be preserved');
});
