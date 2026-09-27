// Origin: spike 3 (daemon-file-sync-fork-import), branch spike/2026-09-27-daemon-file-sync, commit 9343b62, src/md/style.ts
// File-convention detection by majority vote over the source. See brief 02.
import { detectEol } from './parse.js';

export interface Style {
  bullet: '-' | '*' | '+';
  bulletOrdered: '.' | ')';
  emphasis: '*' | '_';
  strong: '*' | '_';
  fence: '`' | '~';
  fenceLen: number;
  headingStyle1: 'atx' | 'setext';
  headingStyle2: 'atx' | 'setext';
  setext: boolean; // combined level 1+2 vote, used for the to-markdown `setext` option
  closeAtx: boolean;
  rule: string;
  ruleRepetition: number;
  listItemIndent: 'one' | 'tab' | 'mixed';
  eol: '\n' | '\r\n';
}

function majority<T>(counts: Map<T, number>, fallback: T): T {
  let best: T = fallback;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function bump<T>(counts: Map<T, number>, key: T, n = 1) {
  counts.set(key, (counts.get(key) ?? 0) + n);
}

export function detectStyle(md: string, mdast: any): Style {
  const bulletCounts = new Map<string, number>();
  const bulletOrderedCounts = new Map<string, number>();
  const emphasisCounts = new Map<string, number>();
  const strongCounts = new Map<string, number>();
  const fenceCounts = new Map<string, number>();
  const fenceLenCounts = new Map<number, number>();
  const headingCounts1 = new Map<string, number>();
  const headingCounts2 = new Map<string, number>();
  const closeAtxCounts = new Map<boolean, number>();
  const ruleCounts = new Map<string, number>();
  const ruleRepCounts = new Map<number, number>();
  const indentCounts = new Map<string, number>();

  const raw = (node: any) => (node.position ? md.slice(node.position.start.offset, node.position.end.offset) : '');

  const walk = (node: any) => {
    switch (node.type) {
      case 'list': {
        const item0 = node.children?.[0];
        if (item0?.position) {
          const markerChar = md[item0.position.start.offset];
          if (node.ordered) {
            const r = raw(item0);
            const m = /^\d+([.)])/.exec(r);
            if (m) bump(bulletOrderedCounts, m[1]);
          } else {
            bump(bulletCounts, markerChar);
          }
          // List item indent: compare continuation-line indentation to the
          // column where the first child's content starts.
          for (const item of node.children ?? []) {
            const first = item.children?.[0];
            if (!item.position || !first?.position) continue;
            const contentCol = first.position.start.offset - item.position.start.offset;
            const itemRaw = raw(item);
            const lines = itemRaw.split(/\r\n|\n/);
            if (lines.length > 1) {
              const secondLine = lines[1];
              const m = /^[ \t]*/.exec(secondLine);
              const indentWidth = m ? m[0].length : 0;
              if (secondLine.trim() === '') continue;
              if (indentWidth === contentCol) bump(indentCounts, 'one');
              else if (indentWidth === 4) bump(indentCounts, 'tab');
            }
          }
        }
        break;
      }
      case 'emphasis': {
        if (node.position) bump(emphasisCounts, md[node.position.start.offset]);
        break;
      }
      case 'strong': {
        if (node.position) bump(strongCounts, md[node.position.start.offset]);
        break;
      }
      case 'code': {
        const r = raw(node);
        const m = /^(`{3,}|~{3,})/.exec(r);
        if (m) {
          bump(fenceCounts, m[1][0]);
          bump(fenceLenCounts, m[1].length);
        }
        break;
      }
      case 'heading': {
        const r = raw(node);
        const firstLine = r.split(/\r\n|\n/, 1)[0];
        const isSetext = firstLine[0] !== '#';
        const style = isSetext ? 'setext' : 'atx';
        if (node.depth === 1) bump(headingCounts1, style);
        else if (node.depth === 2) bump(headingCounts2, style);
        if (!isSetext) {
          const trimmed = firstLine.replace(/[ \t]+$/, '');
          bump(closeAtxCounts, /(?:^|[ \t])#+$/.test(trimmed));
        }
        break;
      }
      case 'thematicBreak': {
        const r = raw(node).trim();
        const ch = r[0];
        if (ch) {
          bump(ruleCounts, ch);
          const rep = r.split('').filter((c: string) => c === ch).length;
          bump(ruleRepCounts, rep);
        }
        break;
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(mdast);

  const setextVotes1 = headingCounts1.get('setext') ?? 0;
  const atxVotes1 = headingCounts1.get('atx') ?? 0;
  const setextVotes2 = headingCounts2.get('setext') ?? 0;
  const atxVotes2 = headingCounts2.get('atx') ?? 0;
  const combinedSetext = setextVotes1 + setextVotes2;
  const combinedAtx = atxVotes1 + atxVotes2;

  return {
    bullet: majority(bulletCounts, '-') as Style['bullet'],
    bulletOrdered: majority(bulletOrderedCounts, '.') as Style['bulletOrdered'],
    emphasis: majority(emphasisCounts, '*') as Style['emphasis'],
    strong: majority(strongCounts, '*') as Style['strong'],
    fence: majority(fenceCounts, '`') as Style['fence'],
    fenceLen: majority(fenceLenCounts, 3),
    headingStyle1: atxVotes1 === 0 && setextVotes1 === 0 ? 'atx' : setextVotes1 >= atxVotes1 ? 'setext' : 'atx',
    headingStyle2: atxVotes2 === 0 && setextVotes2 === 0 ? 'atx' : setextVotes2 >= atxVotes2 ? 'setext' : 'atx',
    setext: combinedSetext > 0 && combinedSetext >= combinedAtx,
    // A tie favors the marked/non-default variant (true), same reasoning as
    // the setext tie-break above: an even split means the file deliberately
    // uses both, so we treat the convention as present rather than absent.
    closeAtx: (closeAtxCounts.get(true) ?? 0) > 0 && (closeAtxCounts.get(true) ?? 0) >= (closeAtxCounts.get(false) ?? 0),
    rule: majority(ruleCounts, '-'),
    ruleRepetition: majority(ruleRepCounts, 3),
    listItemIndent: majority(indentCounts, 'one') as Style['listItemIndent'],
    eol: detectEol(md),
  };
}
