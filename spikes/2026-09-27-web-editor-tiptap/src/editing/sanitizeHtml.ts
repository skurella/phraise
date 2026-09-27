// Brief 03, task 2/7: "HTML preview ... sanitized with DOMPurify (no
// scripts, no event handlers, no `javascript:` URLs, no iframes)".
//
// DOMPurify's own defaults already strip <script> and every `on*` event
// handler attribute and block `javascript:`/`data:` URLs in URL-bearing
// attributes (documented, well-tested upstream behaviour, not
// reimplemented here). What this config adds on top: explicitly forbid
// <iframe> (DOMPurify does NOT forbid it by default -- many WYSIWYG editors
// rely on allowing embeds, so this app opts out) and a handful of other
// tags with no place in a rendered README preview (<style>, <object>,
// <embed>, <form>, <base>, <meta>, <link>) plus the `srcdoc` attribute
// (lets an allowed <iframe>-like element embed its own script content,
// moot once <iframe> itself is forbidden, kept for defense in depth if this
// config is ever loosened).
//
// DOMPurify's ESM build (`dompurify`'s `default` export) auto-detects a
// global `window` at call time -- works unmodified in a real browser and in
// a vitest test file that sets `// @vitest-environment jsdom` (jsdom
// provides `window`/`document` as globals for that file), so this same
// module is what both the node view and this file's own unit test import.
import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';

export const RAW_HTML_SANITIZE_CONFIG: Config = {
  FORBID_TAGS: ['iframe', 'style', 'object', 'embed', 'form', 'base', 'meta', 'link'],
  FORBID_ATTR: ['srcdoc'],
};

export function sanitizeRawHtml(html: string): string {
  return DOMPurify.sanitize(html, RAW_HTML_SANITIZE_CONFIG);
}
