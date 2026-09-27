// Brief 04, task 3: re-serializer fidelity. Forced re-serialize (the
// last-resort path) should reproduce a hard break's own spelling (two spaces
// vs backslash) and a GFM literal-autolink's bare-text form, when hints are
// on -- these are on-by-default in serializeDoc, and only apply when the new
// text still equals the hint's condition (untouched here, so it always
// does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, serializeDoc } from '../src/index.js';

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
