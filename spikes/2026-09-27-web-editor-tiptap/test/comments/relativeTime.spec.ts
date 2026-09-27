import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../../src/comments/relativeTime.js';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  it('just now for under 45s', () => expect(formatRelativeTime(now - 10_000, now)).toBe('just now'));
  it('minutes', () => expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago'));
  it('hours', () => expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago'));
  it('days', () => expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago'));
  it('falls back to a date beyond 30 days', () => expect(formatRelativeTime(now - 40 * 86_400_000, now)).toBe('2026-08-18'));
});
