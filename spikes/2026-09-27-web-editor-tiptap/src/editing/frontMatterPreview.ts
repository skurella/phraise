// Brief 03, task 2: "front matter as a small key-value list or the raw
// text". This is a PREVIEW only -- the source-of-truth text is always the
// raw_block's own source, editable verbatim in the node view's content DOM;
// this parser only has to be good enough to show a friendly summary for the
// common case (a flat YAML/TOML mapping of scalar values) and fall back to
// showing nothing (the caller then shows the raw text instead) for anything
// it is not confident about: nested maps, lists, block scalars, multi-line
// values. Deliberately not a real YAML/TOML parser (no new dependency for a
// preview-only convenience); a hand-rolled parser that recognizes "flat
// mapping" is right for this and admits its limits instead of misrendering
// them.
export interface FrontMatterEntry {
  key: string;
  value: string;
}

// YAML uses `key: value`; TOML uses `key = value`. Accept either so the same
// preview works for both front-matter flavours this app supports.
const KEY_VALUE_LINE = /^([A-Za-z0-9_.-]+)\s*[:=]\s*(.*)$/;

/** Strip one layer of matching quotes from a scalar value, same as YAML/TOML
 * would for a simple quoted string. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse front-matter text (the raw_block's own text content, WITHOUT the
 * `---`/`+++` fence lines -- callers strip those first, see
 * `stripFrontMatterFences`) into a flat key-value list, or `null` if any
 * line looks like something other than a flat scalar mapping (nested
 * structure, a list item, a block scalar continuation, an empty document).
 */
export function parseFlatFrontMatter(text: string): FrontMatterEntry[] | null {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
  if (lines.length === 0) return null;
  const entries: FrontMatterEntry[] = [];
  for (const line of lines) {
    // Reject anything indented (nested mapping/list continuation) or a list
    // item -- not a flat mapping.
    if (/^\s/.test(line) || /^-\s/.test(line.trim())) return null;
    const m = KEY_VALUE_LINE.exec(line);
    if (!m) return null;
    const [, key, rawValue] = m as unknown as [string, string, string];
    const value = unquote(rawValue);
    // A block scalar indicator (`|`, `>`) or an empty value with more
    // content expected below: not flat enough to summarize confidently.
    if (value === '|' || value === '>' || value.startsWith('|') || value.startsWith('>')) return null;
    entries.push({ key, value });
  }
  return entries;
}

/** Strip a leading/trailing `---`/`+++` fence line pair, if present, so
 * `parseFlatFrontMatter` only ever sees the body. Front matter `raw_block`s'
 * own text already includes the fences (see `src/model/parse.ts`'s comment:
 * "the text of an opaque block is its Markdown source, including fences"). */
export function stripFrontMatterFences(text: string): string {
  const lines = text.split(/\r\n|\n/);
  if (lines.length >= 2 && /^(-{3}|\+{3})\s*$/.test(lines[0]!.trim())) {
    const closeIdx = lines.slice(1).findIndex((l) => /^(-{3}|\+{3})\s*$/.test(l.trim()));
    if (closeIdx !== -1) return lines.slice(1, 1 + closeIdx).join('\n');
  }
  return text;
}
