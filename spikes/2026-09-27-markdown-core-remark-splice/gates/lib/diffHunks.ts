// Line-diff containment check for gate B: does every changed hunk between
// the original file and the serialized output fall inside a given source
// line range?
import { diffLines, type Change } from 'diff';

export interface Hunk {
  /** 1-indexed, inclusive line range in the *old* (original) text this hunk touches. */
  oldStart: number;
  oldEnd: number;
}

/**
 * Group `diffLines(oldStr, newStr)` into hunks anchored by old-text line
 * number. A pure insertion (no removed lines) is anchored at the old line
 * it was inserted before/after, with oldStart === oldEnd (a single-line
 * anchor), since it has no width of its own in the old text.
 */
export function computeHunks(oldStr: string, newStr: string): Hunk[] {
  const parts: Change[] = diffLines(oldStr, newStr);
  let oldLine = 1;
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      oldLine += part.count ?? countLines(part.value);
      i++;
      continue;
    }
    let removedCount = 0;
    let j = i;
    while (j < parts.length && (parts[j].added || parts[j].removed)) {
      if (parts[j].removed) removedCount += parts[j].count ?? countLines(parts[j].value);
      j++;
    }
    const start = oldLine;
    const end = oldLine + Math.max(removedCount, 1) - 1;
    hunks.push({ oldStart: start, oldEnd: end });
    oldLine += removedCount;
    i = j;
  }
  return hunks;
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  const n = (value.match(/\n/g) ?? []).length;
  return value.endsWith('\n') ? n : n + 1;
}

export function hunksContained(hunks: Hunk[], startLine: number, endLine: number): boolean {
  return hunks.every((h) => h.oldStart >= startLine && h.oldEnd <= endLine);
}

/** A short excerpt of the first differing hunk's old-text lines, for failure reports. */
export function firstHunkExcerpt(oldStr: string, hunks: Hunk[], maxChars = 200): string {
  if (hunks.length === 0) return '';
  const lines = oldStr.split('\n');
  const h = hunks[0];
  const excerpt = lines.slice(h.oldStart - 1, h.oldEnd).join('\n');
  return excerpt.length > maxChars ? excerpt.slice(0, maxChars) : excerpt;
}
