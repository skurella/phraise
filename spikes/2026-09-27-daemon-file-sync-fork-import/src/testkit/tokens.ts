// Unique tokens for tests: distinct, easy-to-grep markers inserted by edits
// so a test can assert "every inserted token is present" after a merge,
// without caring about exact wording or position.
let counter = 0;

// No underscores: markdown escapes `_` (a plain-text `_` would otherwise
// risk being read as an emphasis marker), which would split a token across
// an escape backslash and break a literal substring search for it.
function slug(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, '');
}

/** A fresh token, distinguishable from ordinary corpus/document text. */
export function makeToken(label = ''): string {
  counter += 1;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `ZZTOK${counter}${slug(label)}${suffix}`;
}

/** Every `makeToken`-shaped token present in `text`, in order of appearance. */
export function tokensIn(text: string): string[] {
  return text.match(/ZZTOK[a-zA-Z0-9]*/g) ?? [];
}
