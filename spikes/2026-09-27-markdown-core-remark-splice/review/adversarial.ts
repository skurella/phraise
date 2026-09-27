// Reviewer adversarial probes (brief 05, priority 1): hand-written edits
// targeting cases gate B's word picker never exercises (headings, table
// cells) plus specific brief-named scenarios (escaped-char neighbor, CRLF,
// list continuation line, heading inside blockquote). Not part of npm
// test/gates; run with `npx tsx review/adversarial.ts` from the spike root.
import { EditorState } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import { parseMarkdown, serializeDoc, semanticEq, type TraceInfo } from '../src/index.js';

interface Case {
  name: string;
  md: string;
  targetType: string; // PM node type name whose textContent holds the word to replace
  word: string;
  replacement: string;
}

function findWordPos(doc: PMNode, targetType: string, word: string): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name !== targetType) return true;
    const full = node.textContent;
    const idx = full.indexOf(word);
    if (idx === -1) return true;
    // Map char offset -> PM offset within this textblock's inline content.
    let charOffset = 0;
    let pmOffset = 0;
    let from = -1, to = -1;
    node.forEach((child) => {
      if (from !== -1) return;
      const text = child.isText ? child.text ?? '' : child.textContent;
      if (idx >= charOffset && idx < charOffset + text.length) {
        from = pos + 1 + pmOffset + (idx - charOffset);
        to = from + word.length;
      }
      charOffset += text.length;
      pmOffset += child.nodeSize;
    });
    if (from !== -1) result = { from, to };
    return false;
  });
  return result;
}

const cases: Case[] = [
  {
    name: 'word-next-to-escaped-char',
    md: 'This is a \\*bold-looking\\* word next to escapes.\n',
    targetType: 'paragraph',
    word: 'looking',
    replacement: 'seeming',
  },
  {
    name: 'word-in-table-cell',
    md: '| A | B |\n| --- | --- |\n| alpha | beta gamma |\n',
    targetType: 'table_cell',
    word: 'gamma',
    replacement: 'zorbo',
  },
  {
    name: 'word-at-start-of-list-continuation-line',
    md: '- one two\n  three four\n  continuing here\n- second item\n',
    targetType: 'paragraph',
    word: 'continuing',
    replacement: 'ongoing',
  },
  {
    name: 'word-in-crlf-file',
    md: 'Line one here.\r\nLine two has a target word.\r\n\r\nSecond paragraph.\r\n',
    targetType: 'paragraph',
    word: 'target',
    replacement: 'chosen',
  },
  {
    name: 'word-in-heading-inside-blockquote',
    md: '> ## A Heading Word\n>\n> Body text.\n',
    targetType: 'heading',
    word: 'Heading',
    replacement: 'Titular',
  },
  {
    name: 'raw-html-block-with-blank-lines (gates.md finding-1 shape)',
    md: '<div>\nfoo\n\nbar\n</div>\n',
    targetType: 'raw_block',
    word: '',
    replacement: '',
  },
];

function run(c: Case) {
  console.log(`\n=== ${c.name} ===`);
  const { doc } = parseMarkdown(c.md);
  if (c.word === '') {
    console.log('(no-op case; inspect only)');
    return;
  }
  const pos = findWordPos(doc, c.targetType, c.word);
  if (!pos) {
    console.log(`SKIP: could not locate word "${c.word}" inside a ${c.targetType} node`);
    console.log('doc:', JSON.stringify(doc.toJSON()));
    return;
  }
  const state = EditorState.create({ doc });
  const tr = state.tr.insertText(c.replacement, pos.from, pos.to);
  const newDoc = tr.doc;
  try {
    newDoc.check();
  } catch (e) {
    console.log('FAIL: newDoc.check() threw', e);
    return;
  }
  const traces: TraceInfo[] = [];
  const out = serializeDoc(newDoc, { trace: (info) => traces.push(info) });
  console.log('--- input ---');
  console.log(JSON.stringify(c.md));
  console.log('--- output ---');
  console.log(JSON.stringify(out));
  console.log('trace kinds:', traces.map((t) => t.kind).join(', '));

  let semanticOk = false;
  let reparsedErr: unknown;
  try {
    const { doc: reparsed } = parseMarkdown(out);
    semanticOk =
      reparsed.childCount === newDoc.childCount &&
      (() => {
        for (let i = 0; i < reparsed.childCount; i++) {
          if (!semanticEq(reparsed.child(i), newDoc.child(i))) return false;
        }
        return true;
      })();
  } catch (e) {
    reparsedErr = e;
  }
  console.log('semanticOk (full reparse vs edited doc):', semanticOk, reparsedErr ? `(threw: ${reparsedErr})` : '');

  // Containment: does the diff touch only the edited top-level block's line range?
  const oldLines = c.md.split(/\r\n|\n/);
  const newLines = out.split(/\r\n|\n/);
  let p = 0;
  while (p < oldLines.length && p < newLines.length && oldLines[p] === newLines[p]) p++;
  let s = 0;
  while (
    s < oldLines.length - p &&
    s < newLines.length - p &&
    oldLines[oldLines.length - 1 - s] === newLines[newLines.length - 1 - s]
  )
    s++;
  const changedOldStart = p + 1;
  const changedOldEnd = Math.max(oldLines.length - s, changedOldStart);
  console.log(`changed old-line range: ${changedOldStart}-${changedOldEnd} (file has ${oldLines.length} lines)`);
}

for (const c of cases) run(c);

// Extra probe: gate B's replacement text is always 'zebra' or 'quokka'
// (gates/lib/words.ts replacementFor) -- plain alnum, never containing a
// markdown-special character. tryTextSplice's escapeMarkdownText exists
// specifically to escape such characters, but gate B's fixed vocabulary
// never inserts one, so that escaping path is unexercised by the gate
// numbers. Probe it directly with a replacement that requires escaping.
console.log('\n=== splice-with-special-char-replacement (not exercised by gate B) ===');
{
  const md = 'Plain paragraph with a word to replace here.\n';
  const { doc } = parseMarkdown(md);
  const pos = findWordPos(doc, 'paragraph', 'word');
  if (pos) {
    const state = EditorState.create({ doc });
    const tr = state.tr.insertText('a*b_c[d]e', pos.from, pos.to);
    const newDoc = tr.doc;
    const traces: TraceInfo[] = [];
    const out = serializeDoc(newDoc, { trace: (info) => traces.push(info) });
    console.log('output:', JSON.stringify(out));
    console.log('trace kinds:', traces.map((t) => t.kind).join(', '));
    const { doc: reparsed } = parseMarkdown(out);
    let ok = reparsed.childCount === newDoc.childCount;
    if (ok) for (let i = 0; i < reparsed.childCount; i++) if (!semanticEq(reparsed.child(i), newDoc.child(i))) ok = false;
    console.log('semanticOk:', ok);
  }
}
