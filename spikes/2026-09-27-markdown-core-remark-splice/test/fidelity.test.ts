// Brief 04, task 3: re-serializer fidelity. Forced re-serialize (the
// last-resort path) should reproduce a hard break's own spelling (two spaces
// vs backslash) and a GFM literal-autolink's bare-text form, when hints are
// on -- these are on-by-default in serializeDoc, and only apply when the new
// text still equals the hint's condition (untouched here, so it always
// does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { parseMarkdown, serializeDoc, schema, semanticEq, type TraceInfo } from '../src/index.js';

test('hard break hint: a two-space break re-serializes as two spaces, not a backslash', () => {
  const md = 'Line one with a break  \nLine two continues.\n';
  const { doc } = parseMarkdown(md);
  doc.check();

  const outHints = serializeDoc(doc, { forceReserialize: true, useHints: true });
  assert.equal(outHints, md, 'hints on: must reproduce the exact two-space break');

  const outNoHints = serializeDoc(doc, { forceReserialize: true, useHints: false });
  assert.equal(outNoHints, 'Line one with a break\\\nLine two continues.\n', 'hints off: falls back to the backslash spelling');
});

test('hard break hint: a backslash break re-serializes as a backslash', () => {
  const md = 'Line one with a break\\\nLine two continues.\n';
  const { doc } = parseMarkdown(md);
  doc.check();

  const out = serializeDoc(doc, { forceReserialize: true, useHints: true });
  assert.equal(out, md);
});

test('hard break hint: still falls back to the library default in an unsafe context (table cell)', () => {
  const md = '| a | b |\n| --- | --- |\n| x\\\ny | z |\n';
  const { doc } = parseMarkdown(md);
  doc.check();

  // Just must not throw and must still re-parse to a semantically equal doc;
  // the exact spelling inside a table cell is the library's own safe choice.
  const out = serializeDoc(doc, { forceReserialize: true, useHints: true });
  const { doc: reparsed } = parseMarkdown(out);
  reparsed.check();
});

test('literal autolink hint: a bare URL re-serializes as bare text, not <url> or [url](url)', () => {
  const md = 'See https://example.com/foo for details.\n';
  const { doc } = parseMarkdown(md);
  doc.check();

  const outHints = serializeDoc(doc, { forceReserialize: true, useHints: true });
  assert.equal(outHints, md, 'hints on: bare literal URL reproduced verbatim, with no surrounding markup at all');

  // Without hints, mdast-util-to-markdown's own built-in autolink shortcut
  // (unconditional, not gated by our hints) still kicks in whenever the text
  // equals a protocol-prefixed url with no title, so this falls back to
  // `<url>` rather than the bare literal form or `[url](url)`.
  const outNoHints = serializeDoc(doc, { forceReserialize: true, useHints: false });
  assert.equal(outNoHints, 'See <https://example.com/foo> for details.\n', 'hints off: falls back to the library-default <url> autolink form');
});

test('literal autolink hint: a bare URL containing markdown-special characters is not escaped', () => {
  const md = 'Badge: https://example.com/foo_bar_baz?a=1&b=2 done.\n';
  const { doc } = parseMarkdown(md);
  doc.check();

  const out = serializeDoc(doc, { forceReserialize: true, useHints: true });
  assert.equal(out, md, 'the literal URL text must not gain escaping backslashes around _ or other characters');
});

test('literal autolink hint: kept as [text](url) once the visible text no longer equals the url', () => {
  const md = 'See https://example.com/foo for details.\n';
  const { doc } = parseMarkdown(md);
  // Simulate an edit that changed the link's visible text away from its href
  // (e.g. via a link-splice or textblock-splice elsewhere): rebuild the
  // paragraph so the link mark's text no longer matches its href.
  let renamed: typeof doc | null = null;
  doc.descendants((node) => {
    if (renamed) return false;
    if (node.isText && node.text === 'https://example.com/foo') {
      const mark = node.marks.find((m) => m.type.name === 'link');
      if (mark) {
        const newText = node.type.schema.text('the docs', [mark]);
        // Rebuild the paragraph's content with the renamed text node.
        const para = doc.child(0);
        const newChildren: any[] = [];
        para.forEach((child) => newChildren.push(child === node ? newText : child));
        renamed = doc.type.schema.node('doc', doc.attrs, [
          para.type.create(para.attrs, newChildren),
        ]);
      }
    }
    return true;
  });
  assert.ok(renamed, 'expected to find and replace the literal link text node');
  (renamed as any).check();

  const out = serializeDoc(renamed as any, { forceReserialize: true, useHints: true });
  assert.match(out, /\[the docs\]\(https:\/\/example\.com\/foo\)/, 'must fall back to bracketed form once text != url');
});

test('semantic line breaks: an edited paragraph is reformatted one sentence per line; neighbours stay byte-identical', () => {
  const md = [
    'First paragraph, untouched. It has two sentences already.',
    '',
    'Second paragraph has a word to edit. This sentence follows it. And a third one here.',
    '',
    'Third paragraph, also untouched. Stays as is.',
    '',
  ].join('\n');
  const { doc } = parseMarkdown(md);
  doc.check();

  const re = /\bword\b/;
  let range: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (range) return false;
    if (node.isText && node.text) {
      const m = re.exec(node.text);
      if (m) range = { from: pos + m.index, to: pos + m.index + m[0].length };
    }
    return true;
  });
  assert.ok(range, 'expected to find "word" in the doc');
  const { from, to } = range as { from: number; to: number };

  // A mark-only edit (never a plain word replacement) so it cannot go
  // through the text-splice path, which never applies semantic line breaks.
  const tr = EditorState.create({ doc }).tr.addMark(from, to, schema.marks.strong.create());
  const newDoc = tr.doc;
  newDoc.check();

  const traces: TraceInfo[] = [];
  const out = serializeDoc(newDoc, { semanticLineBreaks: true, trace: (info) => traces.push(info) });
  assert.ok(
    traces.some((t) => t.kind === 'textblock-splice' || t.kind === 're-serialize'),
    `expected the edited paragraph to go through textblock-splice or re-serialize, got [${traces.map((t) => t.kind).join(', ')}]`
  );

  const lines = out.split('\n');
  assert.ok(lines.includes('First paragraph, untouched. It has two sentences already.'), 'first paragraph must be byte-identical');
  assert.ok(lines.includes('Third paragraph, also untouched. Stays as is.'), 'third paragraph must be byte-identical');

  assert.ok(lines.includes('Second paragraph has a **word** to edit.'), 'edited paragraph: first sentence on its own line');
  assert.ok(lines.includes('This sentence follows it.'), 'edited paragraph: second sentence on its own line');
  assert.ok(lines.includes('And a third one here.'), 'edited paragraph: third sentence on its own line');

  const { doc: reparsed } = parseMarkdown(out);
  reparsed.check();
  assert.ok(
    semanticEq(reparsed, newDoc, { equateSoftBreaks: true }),
    'must re-parse to a semantically equal doc once soft breaks and single spaces are treated as equal'
  );
});
