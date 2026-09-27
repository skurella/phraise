// Brief 07 fix list: "footnote definitions and link reference definitions
// show their Markdown source in monospace in normal view (render them as
// '1. The footnote text' and 'reference link: https://…')". Preview-only,
// same spirit as `frontMatterPreview.ts`: good enough for the common shape
// a footnote/link-reference definition actually has, falls back to `null`
// (the caller then shows the raw text, fence-free) for anything that
// doesn't match it.
//
// The raw_block's own text is its Markdown source verbatim (see
// `src/model/parse.ts`'s comment on `definition`/`footnoteDefinition`
// text), e.g. `[^1]: The footnote's own definition text.` or
// `[ref]: https://example.com/reference "Reference title"`.

export interface FootnoteDefinitionPreview {
  /** The `^id` part between `[^` and `]:`, e.g. `1` -- shown as-is, not
   * renumbered against the document's other footnotes (this is a preview
   * of the definition block, not the reference's own numbering). */
  id: string;
  body: string;
}

const FOOTNOTE_DEFINITION = /^\[\^([^\]]+)\]:[ \t]*([\s\S]*)$/;

export function parseFootnoteDefinition(text: string): FootnoteDefinitionPreview | null {
  const m = FOOTNOTE_DEFINITION.exec(text.trim());
  if (!m) return null;
  const [, id, body] = m as unknown as [string, string, string];
  const trimmedBody = body.trim();
  if (!trimmedBody) return null;
  return { id, body: trimmedBody };
}

export interface LinkReferenceDefinitionPreview {
  label: string;
  url: string;
}

// A link reference definition's label can itself contain escaped `]`, but
// the common case (this is a preview, not a spec-complete parser) is a
// plain label with no nested brackets; the URL is the first whitespace-
// delimited token after the colon (a title, if present, follows in quotes
// and is not shown here -- the friendly summary only asks for the URL).
const LINK_REFERENCE_DEFINITION = /^\[([^\]]+)\]:[ \t]*(\S+)/;

export function parseLinkReferenceDefinition(text: string): LinkReferenceDefinitionPreview | null {
  const m = LINK_REFERENCE_DEFINITION.exec(text.trim());
  if (!m) return null;
  const [, label, rawUrl] = m as unknown as [string, string, string];
  if (label.startsWith('^')) return null; // a footnote definition's own identifier shape, not a link reference's.
  // Strip `<...>` pointy-bracket wrapping, which CommonMark allows around a
  // reference definition's URL (e.g. `[ref]: <https://example.com>`).
  const url = rawUrl.startsWith('<') && rawUrl.endsWith('>') ? rawUrl.slice(1, -1) : rawUrl;
  if (!url) return null;
  return { label, url };
}
