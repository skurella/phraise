// Review finding (2026-09-27): when no candidate verifies, serializeDoc must
// not silently return text whose meaning differs from the document.
// Example from CommonMark example 39: numeric character references decode to
// newlines inside one paragraph; re-serializing writes real newlines, which
// split the paragraph in two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { parseMarkdown, serializeDoc, UnverifiedSerializationError } from '../src/index.ts';

const md = 'foo&#10;&#10;bar\n';

function edited() {
  const { doc } = parseMarkdown(md);
  return EditorState.create({ doc }).tr.insertText('zebra', 1, 4).doc;
}

test('unverified serialization throws by default', () => {
  assert.throws(() => serializeDoc(edited()), UnverifiedSerializationError);
});

test("onUnverified: 'emit' returns the best effort and traces it", () => {
  const kinds: string[] = [];
  const out = serializeDoc(edited(), { onUnverified: 'emit', trace: (t) => kinds.push(t.kind) });
  assert.ok(kinds.includes('unverified'));
  assert.notEqual(out, md);
});
