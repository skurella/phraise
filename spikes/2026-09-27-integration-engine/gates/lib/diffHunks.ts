// Gate E2's containment check. Origin: spike 1 (markdown-core-remark-splice),
// branch spike/2026-09-27-markdown-round-trip, commit 1e1f4a6,
// gates/lib/diffHunks.ts. Ported verbatim (pure line-diff logic; no schema
// dependency, nothing to retarget).
import { diffLines, type Change } from 'diff';

export interface Hunk {
  /** 1-indexed, inclusive line range in the *old* (original) text this hunk touches. */
  oldStart: number;
  oldEnd: number;
}

/**
 * The changed region of the old text, as one envelope hunk: strip the common
 * line prefix and the common line suffix of old and new, and report what is
 * left of the old text. This is stricter than grouping an LCS line diff
 * (several separate hunks count as one envelope spanning all of them) and it
 * is unambiguous: an LCS diff of a file with repeated identical lines may
 * attribute a one-line change to a neighbouring identical line, which made
 * a correct splice look like a change outside the edited paragraph.
 * A pure insertion is anchored at the old line it was inserted before.
 */
export function computeHunks(oldStr: string, newStr: string): Hunk[] {
  if (oldStr === newStr) return [];
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const oldStart = p + 1;
  const oldEnd = Math.max(a.length - s, oldStart);
  return [{ oldStart, oldEnd }];
}

/** The same envelope with diffLines kept available for callers that want LCS hunks. */
export function computeLcsHunks(oldStr: string, newStr: string): Hunk[] {
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
    hunks.push({ oldStart: oldLine, oldEnd: oldLine + Math.max(removedCount, 1) - 1 });
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
