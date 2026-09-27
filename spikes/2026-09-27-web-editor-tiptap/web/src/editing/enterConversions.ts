// Brief 02, task 2: code fence and thematic-break "input rule" affordances.
//
// Unlike heading/list/blockquote (task 2's other affordances, wired in
// `inputRulesExtension.ts` through @tiptap/core's real `InputRule` builders,
// which fire on typing the character that completes the pattern), the brief
// asks for these two to fire on Enter ("typing ``` then Enter", "`---` then
// Enter"): confirmed by trying it that a plain Enter keypress never goes
// through ProseMirror's text-input pipeline that `InputRule`s match against
// (Enter is a distinct key binding, not a character insertion), so these two
// need their own keyboard shortcut rather than a real `InputRule`.
//
// That has one consequence: "Backspace right after an input rule undoes it
// to plain text" (task 2's last bullet) is normally free for a real
// `InputRule` -- Tiptap core's default Backspace chain tries
// `commands.undoInputRule()` first, which reads the input-rules plugin's own
// undo-tracking state. Since these two never go through that plugin, undo
// has to be reimplemented here. Rather than tracking transient "did we just
// convert this" state across the Enter and Backspace keystrokes (fragile:
// any dispatched transaction in between, including a remote collaborator's,
// would need to invalidate it correctly), the reconstruction is done
// structurally from the node's own hint attrs, which fully describe the
// original typed text:
//  - an EMPTY code_block's `fenceHint`/`fenceLenHint`/`lang` reconstruct
//    "```js" (or however many backticks/tildes, with or without a language);
//  - a horizontal_rule's `ruleHint` is the original dashes/asterisks/
//    underscores text verbatim.
// This also means Backspace undoes ANY empty code fence or thematic break at
// the right position, not only one just created by Enter -- which matches
// how Google Docs/Notion actually behave (backspacing out of an empty
// special block always restores a plain paragraph, regardless of how the
// block came to be there), so it is a feature, not an approximation.
import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { matchCodeFenceLine, matchThematicBreakLine } from '../../../src/editing/inputRulePatterns.js';

export const EnterConversions = Extension.create({
  name: 'enterConversions',
  addKeyboardShortcuts() {
    return {
      Enter: () => convertOnEnter(this.editor),
      Backspace: () => undoConversionOnBackspace(this.editor),
    };
  },
});

function convertOnEnter(editor: { state: import('@tiptap/pm/state').EditorState; view: import('@tiptap/pm/view').EditorView }): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.name !== 'paragraph') return false;
  const text = $from.parent.textContent;
  const start = $from.before();
  const end = $from.after();

  const fence = matchCodeFenceLine(text);
  if (fence) {
    const codeBlock = state.schema.nodes.code_block.create({
      lang: fence.lang,
      fenceHint: fence.fenceHint,
      fenceLenHint: fence.fenceLenHint,
      src: null,
      gap: null,
    });
    const tr = state.tr.replaceWith(start, end, codeBlock);
    tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
    view.dispatch(tr);
    return true;
  }

  const hr = matchThematicBreakLine(text);
  if (hr) {
    const hrNode = state.schema.nodes.horizontal_rule.create({ ruleHint: hr.ruleHint, src: null, gap: null });
    const $end = state.doc.resolve(end);
    const hasNextSibling = $end.nodeAfter != null;
    const nodes = hasNextSibling ? [hrNode] : [hrNode, state.schema.nodes.paragraph.createAndFill()!];
    const tr = state.tr.replaceWith(start, end, nodes);
    tr.setSelection(TextSelection.near(tr.doc.resolve(start + hrNode.nodeSize + 1)));
    view.dispatch(tr);
    return true;
  }

  return false;
}

function undoConversionOnBackspace(editor: { state: import('@tiptap/pm/state').EditorState; view: import('@tiptap/pm/view').EditorView }): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;

  // Cursor at the very start of an empty code_block: reconstruct the fence line.
  if ($from.parent.type.name === 'code_block' && $from.parent.content.size === 0 && $from.parentOffset === 0) {
    const node = $from.parent;
    const fenceHint = (node.attrs.fenceHint as string) ?? '`';
    const fenceLenHint = (node.attrs.fenceLenHint as number) ?? 3;
    const lang = (node.attrs.lang as string | null) ?? '';
    const text = fenceHint.repeat(fenceLenHint) + lang;
    const start = $from.before();
    const end = $from.after();
    const paragraph = state.schema.nodes.paragraph.create({ src: null, gap: null }, state.schema.text(text));
    const tr = state.tr.replaceWith(start, end, paragraph);
    tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1 + text.length)));
    view.dispatch(tr);
    return true;
  }

  // Cursor at the very start of an empty textblock immediately preceded by a
  // horizontal_rule: remove the rule and restore its original dashes text.
  if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.parentOffset === 0) {
    const before = $from.before();
    const $before = state.doc.resolve(before);
    const prevNode = $before.nodeBefore;
    if (prevNode && prevNode.type.name === 'horizontal_rule') {
      const ruleHint = (prevNode.attrs.ruleHint as string) ?? '---';
      const hrStart = before - prevNode.nodeSize;
      // Deleting [hrStart, before) removes exactly the horizontal_rule node;
      // the (empty) paragraph that followed it now starts at `hrStart`, so
      // its content position is `hrStart + 1`.
      const tr = state.tr.delete(hrStart, before);
      tr.insertText(ruleHint, hrStart + 1);
      tr.setSelection(TextSelection.near(tr.doc.resolve(hrStart + 1 + ruleHint.length)));
      view.dispatch(tr);
      return true;
    }
  }

  return false;
}
