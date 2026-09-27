// Brief 03, task 2/7 (unit test for the label mapping, including a
// synthetic "unknown" kind standing in for a future/unrecognized construct
// the current parser stack cannot itself produce -- see this brief's log).
import { describe, expect, it } from 'vitest';
import { labelForRawBlockKind, labelForRawInlineKind } from '../src/editing/rawBlockLabels.js';

describe('labelForRawBlockKind', () => {
  it.each([
    ['html', 'HTML'],
    ['yaml', 'Page properties'],
    ['toml', 'Page properties'],
    ['math', 'Formula'],
    ['footnoteDefinition', 'Footnote'],
    ['definition', 'Link reference'],
    ['mdxJsxFlowElement', 'Source'],
    ['unstable:paragraph', 'Source'],
  ])('%s -> %s', (kind, label) => {
    expect(labelForRawBlockKind(kind)).toBe(label);
  });
});

describe('labelForRawInlineKind', () => {
  it.each([
    ['html', 'HTML'],
    ['footnoteReference', 'Footnote ref'],
    ['inlineMath', 'Formula'],
    ['somethingElse', 'Source'],
  ])('%s -> %s', (kind, label) => {
    expect(labelForRawInlineKind(kind)).toBe(label);
  });
});
