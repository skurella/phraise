import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdown, serializeDoc, parseMdast, detectStyle } from '../src/index.js';

const HANDWRITTEN = path.resolve(import.meta.dirname, '../corpus/handwritten');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(HANDWRITTEN, name), 'utf8');
}

test('detectStyle: style-star-bullets.md reports star bullets, underscore emphasis, tilde fences', () => {
  const md = readFixture('style-star-bullets.md');
  const mdast = parseMdast(md);
  const style = detectStyle(md, mdast);
  assert.equal(style.bullet, '*');
  assert.equal(style.emphasis, '_');
  assert.equal(style.strong, '_');
  assert.equal(style.fence, '~');
});

test('detectStyle: style-plus-bullets.md reports plus bullets, star emphasis/strong, closed ATX', () => {
  const md = readFixture('style-plus-bullets.md');
  const mdast = parseMdast(md);
  const style = detectStyle(md, mdast);
  assert.equal(style.bullet, '+');
  assert.equal(style.emphasis, '*');
  assert.equal(style.strong, '*');
  assert.equal(style.fence, '`');
  assert.equal(style.closeAtx, true);
});

test('detectStyle: style-dash-underscore.md reports dash bullets, underscore emphasis, star strong, star rule', () => {
  const md = readFixture('style-dash-underscore.md');
  const mdast = parseMdast(md);
  const style = detectStyle(md, mdast);
  assert.equal(style.bullet, '-');
  assert.equal(style.emphasis, '_');
  assert.equal(style.strong, '*');
  assert.equal(style.rule, '*');
});

test('forced re-serialize with file conventions: style-star-bullets.md uses *, _, __, ~~~, setext', () => {
  const md = readFixture('style-star-bullets.md');
  const { doc } = parseMarkdown(md);
  doc.check();

  const out = serializeDoc(doc, { forceReserialize: true, useHints: false });

  assert.match(out, /^\* First bullet/m, 'expected * bullets');
  assert.match(out, /_emphasis_/, 'expected _ emphasis');
  assert.match(out, /__strong__/, 'expected __ strong');
  assert.match(out, /^~~~/m, 'expected ~~~ fences');
  // Setext: both headings should render as underlined text, not "#".
  assert.ok(!/^#/m.test(out), 'expected no ATX headings when style is setext');
  assert.match(out, /^=+$/m, 'expected a setext level-1 underline');
});
