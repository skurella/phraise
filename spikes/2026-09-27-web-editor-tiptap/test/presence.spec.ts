// Brief 04, task 1/6: colour-from-name is deterministic and badge building
// filters out awareness entries with no user info yet, and produces a
// stable order.
import { describe, expect, it } from 'vitest';
import { colorForName, buildPresenceBadges } from '../src/collab/presence.js';

describe('colorForName', () => {
  it('is deterministic for the same name', () => {
    expect(colorForName('Alice')).toBe(colorForName('Alice'));
  });

  it('differs for different names (not a constant)', () => {
    expect(colorForName('Alice')).not.toBe(colorForName('Bob'));
  });

  it('always returns a valid #rrggbb hex string (not hsl(), which @tiptap/extension-collaboration-caret silently discards -- see the file comment)', () => {
    for (const name of ['Alice', 'Bob', '', 'A very long name indeed']) {
      expect(colorForName(name)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('buildPresenceBadges', () => {
  it('drops entries with no name (not yet set by CollaborationCaret)', () => {
    const badges = buildPresenceBadges([{ clientId: 1, name: 'Alice', color: 'hsl(1,1%,1%)' }, { clientId: 2 }]);
    expect(badges).toEqual([{ clientId: 1, name: 'Alice', color: 'hsl(1,1%,1%)' }]);
  });

  it('fills in a colour from the name when the entry has none of its own', () => {
    const badges = buildPresenceBadges([{ clientId: 1, name: 'Alice' }]);
    expect(badges).toEqual([{ clientId: 1, name: 'Alice', color: colorForName('Alice') }]);
  });

  it('sorts by name then clientId, independent of input order', () => {
    const badges = buildPresenceBadges([
      { clientId: 5, name: 'Bob', color: 'b' },
      { clientId: 2, name: 'Alice', color: 'a2' },
      { clientId: 1, name: 'Alice', color: 'a1' },
    ]);
    expect(badges.map((b) => b.clientId)).toEqual([1, 2, 5]);
  });
});
