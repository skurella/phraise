// @vitest-environment jsdom
//
// Brief 03, task 2/7 (unit test for the sanitizer configuration). Runs the
// REAL DOMPurify against real HTML strings (not just inspecting the config
// object), using vitest's per-file jsdom environment so a global
// `window`/`document` exist for DOMPurify's ESM build to bind to.
import { describe, expect, it } from 'vitest';
import { sanitizeRawHtml } from '../src/editing/sanitizeHtml.js';

describe('sanitizeRawHtml', () => {
  it('removes <script> elements entirely', () => {
    const out = sanitizeRawHtml('<div>hi</div><script>window.pwned = true;</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('pwned');
  });

  it('removes event handler attributes like onerror', () => {
    const out = sanitizeRawHtml('<img src="x" onerror="window.pwned=true">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('pwned');
  });

  it('removes javascript: URLs', () => {
    const out = sanitizeRawHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('removes iframes', () => {
    const out = sanitizeRawHtml('<iframe src="https://example.com"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('keeps ordinary safe markup intact', () => {
    const out = sanitizeRawHtml('<div><strong>bold</strong> and <a href="https://example.com">a link</a></div>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('href="https://example.com"');
  });

  it('keeps plain text with no markup unchanged in substance', () => {
    const out = sanitizeRawHtml('just text');
    expect(out).toBe('just text');
  });
});
