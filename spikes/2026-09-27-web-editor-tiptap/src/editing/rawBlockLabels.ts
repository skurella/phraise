// Brief 03, task 2: "A Tiptap node view with a small grey label naming the
// kind in plain words". Pure mapping from a `raw_block`/`raw_inline`
// `kind` attr (see `src/model/parse.ts` for which values the parser
// produces: `html`, `yaml`, `toml`, `math`, `definition`,
// `footnoteDefinition`; `inlineMath`, `footnoteReference` for inline atoms;
// a bare mdast type name or `'unstable:' + type` for anything the parser
// could not model or could not confirm at load time -- unreachable with the
// current parser plugin stack on valid input, per this brief's log, but
// still a real value the node view must render SOMETHING sensible for).
export function labelForRawBlockKind(kind: string): string {
  switch (kind) {
    case 'html':
      return 'HTML';
    case 'yaml':
    case 'toml':
      return 'Page properties';
    case 'math':
      return 'Formula';
    case 'footnoteDefinition':
      return 'Footnote';
    case 'definition':
      return 'Link reference';
    default:
      return 'Source';
  }
}

export function labelForRawInlineKind(kind: string): string {
  switch (kind) {
    case 'html':
      return 'HTML';
    case 'footnoteReference':
      return 'Footnote ref';
    case 'inlineMath':
      return 'Formula';
    default:
      return 'Source';
  }
}
