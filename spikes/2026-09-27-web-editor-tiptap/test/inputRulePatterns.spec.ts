// Brief 02, task 2/4: headless unit tests for the pure input-rule patterns.
import { describe, expect, it } from 'vitest';
import {
  HEADING_RULE,
  headingAttrs,
  BULLET_LIST_RULE,
  bulletListAttrs,
  ORDERED_LIST_RULE,
  orderedListAttrs,
  BLOCKQUOTE_RULE,
  matchCodeFenceLine,
  matchThematicBreakLine,
} from '../src/editing/inputRulePatterns.js';

describe('HEADING_RULE', () => {
  it('matches 1 to 6 hashes followed by a space', () => {
    for (let n = 1; n <= 6; n++) {
      const text = '#'.repeat(n) + ' ';
      const m = HEADING_RULE.exec(text);
      expect(m, text).not.toBeNull();
      expect(headingAttrs(m!)).toEqual({ level: n });
    }
  });

  it('does not match 7 hashes (not a valid ATX heading) or a hash with no space', () => {
    expect(HEADING_RULE.test('####### ')).toBe(false);
    expect(HEADING_RULE.test('#')).toBe(false);
    expect(HEADING_RULE.test('#x')).toBe(false);
  });
});

describe('BULLET_LIST_RULE', () => {
  it('matches "- " and "* "', () => {
    expect(bulletListAttrs(BULLET_LIST_RULE.exec('- ')!)).toEqual({ markerHint: '-' });
    expect(bulletListAttrs(BULLET_LIST_RULE.exec('* ')!)).toEqual({ markerHint: '*' });
  });

  it('does not match three dashes (thematic break territory) or a dash with no space', () => {
    expect(BULLET_LIST_RULE.test('---')).toBe(false);
    expect(BULLET_LIST_RULE.test('-')).toBe(false);
  });
});

describe('ORDERED_LIST_RULE', () => {
  it('matches "1. " with the typed start number and delimiter', () => {
    expect(orderedListAttrs(ORDERED_LIST_RULE.exec('1. ')!)).toEqual({ start: 1, delimHint: '.' });
    expect(orderedListAttrs(ORDERED_LIST_RULE.exec('7) ')!)).toEqual({ start: 7, delimHint: ')' });
  });
});

describe('BLOCKQUOTE_RULE', () => {
  it('matches "> "', () => {
    expect(BLOCKQUOTE_RULE.test('> ')).toBe(true);
    expect(BLOCKQUOTE_RULE.test('>')).toBe(false);
  });
});

describe('matchCodeFenceLine', () => {
  it('matches a bare fence with no language', () => {
    expect(matchCodeFenceLine('```')).toEqual({ fenceHint: '`', fenceLenHint: 3, lang: null });
  });

  it('matches a fence with a language tag', () => {
    expect(matchCodeFenceLine('```js')).toEqual({ fenceHint: '`', fenceLenHint: 3, lang: 'js' });
  });

  it('matches a tilde fence', () => {
    expect(matchCodeFenceLine('~~~python')).toEqual({ fenceHint: '~', fenceLenHint: 3, lang: 'python' });
  });

  it('rejects a line with content after the language tag, or fewer than 3 backticks', () => {
    expect(matchCodeFenceLine('```js extra stuff')).toBeNull();
    expect(matchCodeFenceLine('``')).toBeNull();
    expect(matchCodeFenceLine('some text')).toBeNull();
  });
});

describe('matchThematicBreakLine', () => {
  it('matches three or more dashes/asterisks/underscores alone on the line', () => {
    expect(matchThematicBreakLine('---')).toEqual({ ruleHint: '---' });
    expect(matchThematicBreakLine('****')).toEqual({ ruleHint: '****' });
    expect(matchThematicBreakLine('___')).toEqual({ ruleHint: '___' });
  });

  it('rejects fewer than three, or any trailing content', () => {
    expect(matchThematicBreakLine('--')).toBeNull();
    expect(matchThematicBreakLine('--- x')).toBeNull();
  });
});
