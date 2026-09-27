// Brief 02, task 2: Markdown input-rule affordances (heading, bullet/ordered
// list, blockquote) using @tiptap/core's real `InputRule` builders, so
// "Backspace right after undoes it" is free (`commands.undoInputRule()`,
// already first in core's default Backspace chain, reads these rules' own
// undo-tracking state). Code fence and thematic break fire on Enter instead
// -- see `enterConversions.ts`'s comment for why, and how their own
// Backspace-undo is reconstructed structurally instead.
//
// The regexes and attribute-extraction functions themselves live in
// `src/editing/inputRulePatterns.ts` (schema-free, unit tested); this file
// only wires them to real node types via `wrappingInputRule`/
// `textblockTypeInputRule`.
import { Extension, wrappingInputRule, textblockTypeInputRule } from '@tiptap/core';
import {
  HEADING_RULE,
  headingAttrs,
  BULLET_LIST_RULE,
  bulletListAttrs,
  ORDERED_LIST_RULE,
  orderedListAttrs,
  BLOCKQUOTE_RULE,
} from '../../../src/editing/inputRulePatterns.js';

export const MarkdownInputRules = Extension.create({
  name: 'markdownInputRules',
  addInputRules() {
    const schema = this.editor.schema;
    return [
      textblockTypeInputRule({
        find: HEADING_RULE,
        type: schema.nodes.heading!,
        getAttributes: (match) => headingAttrs(match),
      }),
      wrappingInputRule({
        find: BULLET_LIST_RULE,
        type: schema.nodes.bullet_list!,
        getAttributes: (match) => bulletListAttrs(match),
      }),
      wrappingInputRule({
        find: ORDERED_LIST_RULE,
        type: schema.nodes.ordered_list!,
        getAttributes: (match) => orderedListAttrs(match),
      }),
      wrappingInputRule({
        find: BLOCKQUOTE_RULE,
        type: schema.nodes.blockquote!,
      }),
    ];
  },
});
