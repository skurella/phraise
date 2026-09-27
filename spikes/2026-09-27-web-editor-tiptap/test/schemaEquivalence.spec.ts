// Brief 01, task 7: "checkSchemaEquivalence passes for the full extension
// list the page uses, and fails if a node is added." Builds exactly the
// extension list web/src/main.ts constructs (converted schema +
// Collaboration + CollaborationCaret + PhraiseWorkarounds), with stand-in
// Y.Doc/provider objects since getSchema() only reads each extension's node
// schema, never touches the provider or ProseMirror plugins.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Node, getSchema, type AnyExtension } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { schema } from '../src/model/schema.js';
import { buildTiptapExtensions, checkSchemaEquivalence } from '../src/collab/tiptapExtensions.js';
import { PhraiseWorkarounds } from '../src/collab/tiptapWorkaroundsExtension.js';
import { FRAGMENT_NAME } from '../src/model/yjs.js';

function pageExtensions(): AnyExtension[] {
  const ydoc = new Y.Doc();
  return [
    ...buildTiptapExtensions(),
    Collaboration.configure({ document: ydoc, field: FRAGMENT_NAME }),
    CollaborationCaret.configure({
      provider: {} as never,
      user: { name: 'Test', color: '#000000' },
      render: () => window.document.createElement('span'),
    }),
    PhraiseWorkarounds.configure({
      ydoc,
      stats: {
        rootAttrs: { mapWrites: 0, docWrites: 0 },
        leafMarks: { attrWrites: 0, restores: 0 },
        localCaretFollow: { corrections: 0 },
      },
    }),
  ];
}

describe('checkSchemaEquivalence', () => {
  it('passes for the full extension list the page uses', () => {
    const tiptapSchema = getSchema(pageExtensions());
    const { equal, diffs } = checkSchemaEquivalence(tiptapSchema, schema);
    expect(diffs).toEqual([]);
    expect(equal).toBe(true);
  });

  it('fails if a node is added', () => {
    const extraNode = Node.create({ name: 'extra_test_node', group: 'block', content: 'text*' });
    const tiptapSchema = getSchema([...pageExtensions(), extraNode]);
    const { equal, diffs } = checkSchemaEquivalence(tiptapSchema, schema);
    expect(equal).toBe(false);
    expect(diffs.some((d) => d.includes('extra_test_node'))).toBe(true);
  });
});
