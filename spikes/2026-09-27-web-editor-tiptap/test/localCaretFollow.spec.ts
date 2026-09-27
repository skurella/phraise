// @vitest-environment jsdom
//
// Brief 05, gate D/E: unit coverage for `localCaretFollowPlugin`'s
// restraint -- it must be a true no-op (no selection override, no stats
// increment) whenever nothing needs correcting, so it never becomes a
// second source of selection bugs on top of the one it works around. The
// actual bug (y-tiptap 3.0.9's `recoverSelectionEndpoint` misresolving an
// idle local caret across a remote edit elsewhere in the same paragraph)
// and the fix are proven at the Playwright level, with the real app, real
// schema and real relay -- see `e2e/gateD-collab.spec.ts`'s
// "the local caret stays in place while the other user types before it in
// the same paragraph" test and the builder log: a hand-rolled minimal
// two-Y.Doc reproduction here (real `ProsemirrorBinding`s, but a toy
// schema, no relay) was tried first and did NOT reproduce the misresolution
// -- `findAbsolutePositionAfterStructuralChange`'s block-matching heuristic
// correctly found no candidate for a pure insertion-before-cursor edit and
// fell back to the (already correct) Yjs-resolved position in that
// simplified shape, even though the bug is real and reproducible end to end
// with the real app (see the log for the full trace of why the minimal
// repro didn't match; not asserted here to avoid a unit test that encodes
// a wrong belief about exactly which internal branch fires).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Schema, Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ySyncPlugin, prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import { localCaretFollowPlugin, type LocalCaretFollowStats } from '../src/collab/workarounds/localCaretFollow.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { inline: true },
  },
});

/** Builds a fresh Y.Doc seeded with `paragraphs` (one plain-text paragraph
 * each) and a real EditorView bound to it via `ySyncPlugin` +
 * `localCaretFollowPlugin`. */
function seededView(paragraphs: string[], stats: LocalCaretFollowStats): { ydoc: Y.Doc; view: EditorView } {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('prosemirror');
  const seedDoc = schema.node(
    'doc',
    null,
    paragraphs.map((t) => schema.node('paragraph', null, t ? [schema.text(t)] : [])),
  );
  prosemirrorToYXmlFragment(seedDoc as unknown as PMNode, fragment);
  const state = EditorState.create({ schema, plugins: [ySyncPlugin(fragment), localCaretFollowPlugin(stats)] });
  const view = new EditorView(document.createElement('div'), { state });
  return { ydoc, view };
}

/** Builds a second EditorView on a Y.Doc cloned from `source`'s current
 * state -- a second replica, already carrying the same content, with no
 * re-seeding of its own. */
function replicaView(source: Y.Doc, stats: LocalCaretFollowStats): { ydoc: Y.Doc; view: EditorView } {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(source));
  const fragment = ydoc.getXmlFragment('prosemirror');
  const state = EditorState.create({ schema, plugins: [ySyncPlugin(fragment), localCaretFollowPlugin(stats)] });
  const view = new EditorView(document.createElement('div'), { state });
  return { ydoc, view };
}

function propagate(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

describe('localCaretFollowPlugin', () => {
  it('does not touch the selection (and records no correction) for a remote edit in a different paragraph than the local caret', () => {
    const bobStats: LocalCaretFollowStats = { corrections: 0 };
    const { ydoc: bobDoc, view: bobView } = seededView(['First paragraph.', 'Second paragraph.'], bobStats);
    const { ydoc: editDoc, view: editView } = replicaView(bobDoc, { corrections: 0 });

    // Bob's caret in the FIRST paragraph.
    const firstParaEnd = 1 + 'First paragraph.'.length;
    bobView.dispatch(bobView.state.tr.setSelection(TextSelection.create(bobView.state.doc, firstParaEnd)));

    // A second replica edits the SECOND paragraph only, then the change is
    // propagated to Bob's Y.Doc the same way a relay would.
    const secondParaStart = bobView.state.doc.content.size - 'Second paragraph.'.length - 1;
    editView.dispatch(editView.state.tr.insertText('XYZ ', secondParaStart));
    propagate(editDoc, bobDoc);

    expect(bobView.state.doc.textContent).toBe('First paragraph.XYZ Second paragraph.');
    expect(bobView.state.selection.head).toBe(firstParaEnd); // unaffected
    expect(bobStats.corrections).toBe(0); // nothing for this plugin to fix
  });

  it('is inert (no-op) for a transaction that is not a remote/undo change at all (an ordinary local selection move)', () => {
    const stats: LocalCaretFollowStats = { corrections: 0 };
    const { view } = seededView(['Hello world'], stats);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + 'Hello world'.length)));

    expect(stats.corrections).toBe(0);
  });
});
