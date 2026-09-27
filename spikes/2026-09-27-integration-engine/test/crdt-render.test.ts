// Brief 01 task 6: "render never throws on a block it cannot verify and
// reports it as degraded." D9 (a save never fails and never silently
// changes meaning: best effort plus a flag on the block).
//
// Manufactured failure: a `link` mark with a reference identifier
// ("ghost") that has no matching `[ghost]: url` definition anywhere in the
// document. Serializing it emits a shortcut reference `[ghost]`; reparsing
// that with no definition in scope, remark resolves it to plain bracketed
// text, not a link -- so the re-parsed block is no longer semantically
// equal to the original (the link mark is gone). That is exactly the
// "no serialization that re-parses to the edited block" case
// serializeDoc's `onUnverified: 'emit'` (which render()/renderDoc() always
// pass) reports through `trace` instead of throwing.
import { test, expect } from 'vitest';
import { schema } from '../src/markdown/index.js';
import { createDoc, seed, render } from '../src/crdt/index.js';

test('render never throws on a block with no verifying serialization, and reports it as degraded', () => {
  const linkMark = schema.marks.link.create({
    href: '',
    title: null,
    refType: 'shortcut',
    identifier: 'ghost',
    label: 'ghost',
    kindHint: 'reference',
  });
  const para = schema.node('paragraph', {}, [schema.text('ghost', [linkMark])]);
  const pmDoc = schema.node('doc', { lead: '', eol: '\n' }, [para]);

  const doc = createDoc();
  seed(doc, pmDoc);

  let result: ReturnType<typeof render> | undefined;
  expect(() => {
    result = render(doc);
  }).not.toThrow();

  expect(result).toBeDefined();
  expect(result!.degraded).toContain(0);
  // Best effort: the text content survives even though the markup (the
  // link) could not be verified.
  expect(result!.text).toContain('ghost');
});

test('render reports composed:true and no boundary repairs for an ordinary multi-block document', () => {
  const p1 = schema.node('paragraph', {}, [schema.text('First paragraph.')]);
  const p2 = schema.node('paragraph', {}, [schema.text('Second paragraph.')]);
  const pmDoc = schema.node('doc', { lead: '', eol: '\n' }, [p1, p2]);

  const doc = createDoc();
  seed(doc, pmDoc);

  const result = render(doc);
  expect(result.composed).toBe(true);
  expect(result.boundaryRepairs).toBe(0);
  expect(result.degraded).toEqual([]);
  expect(result.text).toContain('First paragraph.');
  expect(result.text).toContain('Second paragraph.');
});
