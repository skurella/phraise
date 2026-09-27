// Brief 02, task 1/4: headless unit test for the fresh-src plugin. Builds a
// real EditorState with the plugin installed, runs the real
// `prosemirror-commands` `splitBlock`/`joinBackward` (the same functions
// Tiptap's core Keymap extension calls) and asserts on the resulting doc's
// attrs -- not a hand-rolled transaction, so this exercises the exact step
// shape a real Enter/Backspace keypress produces.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { splitBlock, joinBackward } from 'prosemirror-commands';
import { splitListItem } from 'prosemirror-schema-list';
import { schema } from '../src/model/schema.js';
import { freshSrcPlugin } from '../src/editing/freshSrc.js';

function stateWithDoc(doc: ReturnType<typeof schema.node>, selectionPos: number) {
  const state = EditorState.create({ schema, doc, plugins: [freshSrcPlugin()] });
  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(selectionPos)));
  return state.apply(tr);
}

function para(text: string, src: string | null, gap: string | null = '\n\n') {
  return schema.node('paragraph', { src, gap }, text ? [schema.text(text)] : []);
}

describe('freshSrcPlugin', () => {
  it('nulls src and gap only on the second half of a top-level Enter split', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('Hello world.', 'Hello world.')]);
    const splitAt = 1 + 'Hello '.length; // between "Hello " and "world."
    const state = stateWithDoc(doc, splitAt);

    let dispatched: Transaction | undefined;
    const ok = splitBlock(state, (tr) => {
      dispatched = tr;
    });
    expect(ok).toBe(true);
    const newState = state.apply(dispatched!);

    expect(newState.doc.childCount).toBe(2);
    const first = newState.doc.child(0);
    const second = newState.doc.child(1);
    expect(first.textContent).toBe('Hello ');
    expect(second.textContent).toBe('world.');
    // Surviving (first) half keeps its src (its own text up to the split
    // point is unchanged and still verifies against it), but its gap is
    // nulled too: it now has a genuinely new neighbour, and its old gap
    // may have been tuned for whatever used to follow it (e.g. the file's
    // own trailing bytes, if it used to be the last block) -- see the file
    // comment's paste-into-the-last-block finding.
    expect(first.attrs.src).toBe('Hello world.');
    expect(first.attrs.gap).toBeNull();
    // New (second) half must not inherit either.
    expect(second.attrs.src).toBeNull();
    expect(second.attrs.gap).toBeNull();
  });

  it('nulls a stale trailing gap on the surviving half when splitting the document\'s last block (paste-at-end shape)', () => {
    // A block that used to be the LAST block in its file has a gap that
    // reflects the file's own trailing bytes (here a single '\n', not the
    // '\n\n' convention between two blocks) -- found for real via a paste
    // that inserted new content right after such a block (see the file
    // comment): the stale gap glued the new content on with no blank line.
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('target', 'target', '\n')]);
    const splitAt = 1 + 'target'.length; // at the very end
    const state = stateWithDoc(doc, splitAt);

    let dispatched: Transaction | undefined;
    splitBlock(state, (tr) => {
      dispatched = tr;
    });
    const newState = state.apply(dispatched!);

    expect(newState.doc.childCount).toBe(2);
    expect(newState.doc.child(0).textContent).toBe('target');
    expect(newState.doc.child(0).attrs.src).toBe('target'); // unchanged: its own text is unchanged
    expect(newState.doc.child(0).attrs.gap).toBeNull(); // stale trailing gap invalidated
  });

  it('splits a heading the same way as a paragraph', () => {
    const heading = schema.node('heading', { level: 2, src: '## Title here', gap: '\n\n' }, [schema.text('Title here')]);
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [heading]);
    const splitAt = 1 + 'Title '.length;
    const state = stateWithDoc(doc, splitAt);

    let dispatched: Transaction | undefined;
    splitBlock(state, (tr) => {
      dispatched = tr;
    });
    const newState = state.apply(dispatched!);

    expect(newState.doc.childCount).toBe(2);
    expect(newState.doc.child(0).attrs.src).toBe('## Title here');
    expect(newState.doc.child(1).type.name).toBe('heading'); // no atEnd-deflt fallback mid-text
    expect(newState.doc.child(1).attrs.src).toBeNull();
    expect(newState.doc.child(1).attrs.gap).toBeNull();
  });

  it('leaves a join (Backspace merging into the previous block) alone: the surviving block keeps its src', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [
      para('First paragraph.', 'First paragraph.', '\n\n'),
      para('Second paragraph.', 'Second paragraph.', null),
    ]);
    const posAtSecondStart = doc.child(0).nodeSize + 1;
    const state = stateWithDoc(doc, posAtSecondStart);

    let dispatched: Transaction | undefined;
    const ok = joinBackward(state, (tr) => {
      dispatched = tr;
    });
    expect(ok).toBe(true);
    const newState = state.apply(dispatched!);

    expect(newState.doc.childCount).toBe(1);
    const merged = newState.doc.child(0);
    expect(merged.textContent).toBe('First paragraph.Second paragraph.');
    // The surviving block (the first paragraph) keeps its own src untouched.
    expect(merged.attrs.src).toBe('First paragraph.');
  });

  it('does not touch a nested split (Enter inside a list item), since nested blocks never carry a meaningful src', () => {
    const item = schema.node('list_item', {}, [para('First item text.', null, null)]);
    const list = schema.node('bullet_list', { src: '- First item text.', gap: null }, [item]);
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [list]);
    const splitAt = 1 + 1 + 'First '.length; // doc > bullet_list > list_item > paragraph text
    const state = stateWithDoc(doc, splitAt);

    let dispatched: Transaction | undefined;
    const ok = splitListItem(schema.nodes.list_item)(state, (tr) => {
      dispatched = tr;
    });
    expect(ok).toBe(true);
    const newState = state.apply(dispatched!);

    const newList = newState.doc.child(0);
    expect(newList.type.name).toBe('bullet_list');
    expect(newList.childCount).toBe(2);
    // The list itself (the actual top-level block) is untouched by a nested split.
    expect(newList.attrs.src).toBe('- First item text.');
  });

  it('does not touch a paste-style replace (from !== to), only a pure split', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('Hello world.', 'Hello world.')]);
    const state = stateWithDoc(doc, 1);
    const inserted = schema.node('paragraph', { src: 'Pasted.', gap: null }, [schema.text('Pasted.')]);
    // Replace the whole top-level paragraph (position 0 to its nodeSize),
    // not a range inside its content -- the shape a real paste of one whole
    // block over a selection produces.
    const tr = state.tr.replaceWith(0, doc.child(0).nodeSize, inserted);
    const newState = state.apply(tr);
    expect(newState.doc.childCount).toBe(1);
    // Our own inserted node's real src is left alone: this is a replace, not a split.
    expect(newState.doc.child(0).attrs.src).toBe('Pasted.');
  });
});
