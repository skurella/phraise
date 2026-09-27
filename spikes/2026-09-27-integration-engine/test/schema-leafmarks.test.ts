// Brief 01 task 6: "a schema test that every inline atom node type declares
// leafMarks." Plan section 3 point 2. An inline atom (leaf) node is one
// that is inline, a leaf (isLeaf === true, i.e. cannot hold marks-carrying
// children on its own), and not the `text` node type itself -- exactly the
// set src/crdt/codec.ts's encodeLeafMarks/decodeLeafMarks and
// workarounds/leafMarks.ts operate on.
import { test, expect } from 'vitest';
import { schema } from '../src/markdown/index.js';

test('every inline atom (leaf, non-text) node type declares a leafMarks attr', () => {
  const inlineAtomTypes = Object.values(schema.nodes).filter(
    (nt) => nt.isInline && nt.isLeaf && nt.name !== 'text',
  );
  expect(inlineAtomTypes.length).toBeGreaterThan(0);
  for (const nt of inlineAtomTypes) {
    expect(nt.spec.attrs, `${nt.name} has no attrs at all`).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(nt.spec.attrs, 'leafMarks'), `${nt.name} is missing leafMarks`).toBe(
      true,
    );
  }
});
