// Brief 02, task 2/4: the pure Markdown-affordance patterns, kept separate
// from their Tiptap wiring (`web/src/editing/inputRulesExtension.ts`) so the
// matching logic itself is unit-testable headless.
//
// Heading/list/blockquote fire the usual way an `InputRule` does: on typing
// the character that completes the pattern (the trailing space). Code fence
// and thematic break are different in this spike, matching the brief: they
// fire on Enter, checking whether the CURRENT paragraph's whole text (not
// just its tail) matches, because "typing the fence/dashes" alone is
// ambiguous with someone just typing three dashes or backticks as prose --
// Enter is the user's actual confirmation, same reasoning Google Docs and
// Tiptap apply elsewhere (e.g. why Backspace right after any of these undoes
// them, task 2's last bullet).

/** `# ` .. `###### ` at the start of an empty or plain paragraph. */
export const HEADING_RULE = /^(#{1,6})\s$/;
export function headingAttrs(match: RegExpMatchArray): { level: number } {
  return { level: match[1]!.length };
}

/** `- ` or `* ` at the start of an empty or plain paragraph. */
export const BULLET_LIST_RULE = /^\s*([-*])\s$/;
export function bulletListAttrs(match: RegExpMatchArray): { markerHint: string } {
  return { markerHint: match[1]! };
}

/** `1. ` (or any starting number) at the start of an empty or plain paragraph. */
export const ORDERED_LIST_RULE = /^\s*(\d+)([.)])\s$/;
export function orderedListAttrs(match: RegExpMatchArray): { start: number; delimHint: string } {
  return { start: Number(match[1]), delimHint: match[2]! };
}

/** `> ` at the start of an empty or plain paragraph. */
export const BLOCKQUOTE_RULE = /^\s*>\s$/;

/** A code fence line on its own (```` ``` ```` or ```` ```js ````), matched
 * against a paragraph's FULL text on Enter. Also accepts `~~~`, which
 * `src/model/parse.ts`/`style.ts` also recognize as a fence marker. */
export const CODE_FENCE_LINE_RULE = /^(`{3,}|~{3,})([A-Za-z0-9_+-]*)$/;
export function matchCodeFenceLine(text: string): { fenceHint: string; fenceLenHint: number; lang: string | null } | null {
  const m = CODE_FENCE_LINE_RULE.exec(text);
  if (!m) return null;
  const fence = m[1]!;
  const lang = m[2] || null;
  return { fenceHint: fence[0]!, fenceLenHint: fence.length, lang };
}

/** `---` (or `***`/`___`, 3 or more) on its own line, matched against a
 * paragraph's FULL text on Enter -- a thematic break. Deliberately excludes a
 * bare `-` or `--` (too easy to type by accident) and excludes anything with
 * trailing content. */
export const THEMATIC_BREAK_LINE_RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
export function matchThematicBreakLine(text: string): { ruleHint: string } | null {
  return THEMATIC_BREAK_LINE_RULE.test(text) ? { ruleHint: text } : null;
}
