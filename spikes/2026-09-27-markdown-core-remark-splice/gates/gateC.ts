// Gate C: opaque and special constructs. Threshold: every file containing
// the construct passes gate A, and gate B's containment holds for all edits
// in those files. Scanned over corpus files (real + handwritten).
import { parseMdast } from '../src/index.js';
import type { ParsedFile } from './lib/parsedFile.js';
import type { GateAFileResult } from './gateA.js';
import type { FileWordResult, EditResult } from './gateB.js';
import { topLevelSpans } from './lib/topSpans.js';

export type ConstructKind =
  | 'frontmatter'
  | 'raw-html'
  | 'mdx'
  | 'math-block'
  | 'math-inline'
  | 'footnote-definition'
  | 'link-reference-definition'
  | 'mermaid'
  | 'fenced-code'
  | 'table';

// Constructs that always form their own top-level block (as opposed to
// math-inline, which lives inside a paragraph and has no top-level span of
// its own), i.e. the ones the outside-edited-block byte-identity check
// applies to.
const TOP_LEVEL_KINDS = new Set<ConstructKind>([
  'frontmatter',
  'raw-html',
  'mdx',
  'math-block',
  'footnote-definition',
  'link-reference-definition',
  'mermaid',
  'fenced-code',
  'table',
]);

function classifyNode(node: any, source: string): ConstructKind | undefined {
  switch (node.type) {
    case 'yaml':
    case 'toml':
      return 'frontmatter';
    case 'html': {
      const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : (node.value ?? '');
      const m = /^<\/?\s*([A-Za-z][A-Za-z0-9]*)/.exec(raw);
      if (m && /^[A-Z]/.test(m[1])) return 'mdx';
      return 'raw-html';
    }
    case 'paragraph': {
      if (!node.position) return undefined;
      const raw = source.slice(node.position.start.offset, node.position.end.offset);
      if (/^\s*(import|export)\s/.test(raw)) return 'mdx';
      return undefined;
    }
    case 'math':
      return 'math-block';
    case 'inlineMath':
      return 'math-inline';
    case 'footnoteDefinition':
      return 'footnote-definition';
    case 'definition':
      return 'link-reference-definition';
    case 'code': {
      const lang = (node.lang ?? '').toLowerCase();
      if (lang === 'mermaid') return 'mermaid';
      const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
      if (/^[`~]/.test(raw)) return 'fenced-code';
      return undefined; // indented code: not in the brief's opaque/special list
    }
    case 'table':
      return 'table';
    default:
      return undefined;
  }
}

function walkAll(node: any, source: string, cb: (kind: ConstructKind) => void) {
  const kind = classifyNode(node, source);
  if (kind) cb(kind);
  for (const c of node.children ?? []) walkAll(c, source, cb);
}

/** Construct kind for each of the file's *top-level* mdast children, parallel to doc's top-level blocks. */
function topLevelKinds(md: string): (ConstructKind | undefined)[] {
  const root = parseMdast(md);
  return (root.children ?? []).map((c: any) => classifyNode(c, md));
}

export interface ConstructStats {
  kind: ConstructKind;
  filesContaining: number;
  blockCount: number;
  aPassFiles: number;
  bFilePassFiles: number; // of the non-n/a files containing the construct
  bFileNaFiles: number;
  crossCheckChecked: number;
  crossCheckPreserved: number;
  exampleMismatch?: string;
}

export interface GateCResult {
  stats: ConstructStats[];
}

export function runGateC(files: ParsedFile[], gateA: Map<string, GateAFileResult>, gateB: Map<string, FileWordResult>): GateCResult {
  const kinds: ConstructKind[] = [
    'frontmatter',
    'raw-html',
    'mdx',
    'math-block',
    'math-inline',
    'footnote-definition',
    'link-reference-definition',
    'mermaid',
    'fenced-code',
    'table',
  ];

  const stats = new Map<ConstructKind, ConstructStats>();
  for (const k of kinds) {
    stats.set(k, {
      kind: k,
      filesContaining: 0,
      blockCount: 0,
      aPassFiles: 0,
      bFilePassFiles: 0,
      bFileNaFiles: 0,
      crossCheckChecked: 0,
      crossCheckPreserved: 0,
    });
  }

  // Per-file top-level construct classification, cached for the cross-check pass below.
  const topKindsByFile = new Map<string, (ConstructKind | undefined)[]>();

  for (const pf of files) {
    if (pf.error) continue;
    const root = parseMdast(pf.file.md);
    const counts = new Map<ConstructKind, number>();
    walkAll(root, pf.file.md, (k) => counts.set(k, (counts.get(k) ?? 0) + 1));

    const aResult = gateA.get(pf.file.id);
    const bResult = gateB.get(pf.file.id);

    for (const [k, count] of counts) {
      const s = stats.get(k)!;
      s.filesContaining++;
      s.blockCount += count;
      if (aResult?.ok) s.aPassFiles++;
      if (bResult) {
        if (bResult.na) s.bFileNaFiles++;
        else if (bResult.edits.every((e) => e.category === 'ok')) s.bFilePassFiles++;
      }
    }

    topKindsByFile.set(pf.file.id, topLevelKinds(pf.file.md));
  }

  // Cross-check: for every gate B edit, every top-level block of a
  // TOP_LEVEL_KINDS construct outside the edited block must appear
  // byte-identical in `out` at its own (pre-edit) line range.
  for (const pf of files) {
    if (pf.error) continue;
    const bResult = gateB.get(pf.file.id);
    if (!bResult || bResult.na) continue;
    const topKinds = topKindsByFile.get(pf.file.id);
    if (!topKinds) continue;
    const spans = topLevelSpans(pf);
    const mdLines = pf.file.md.split('\n');

    for (const edit of bResult.edits as EditResult[]) {
      if (edit.category === 'exception' || edit.out == null) continue;
      const outLines = edit.out.split('\n');
      for (let j = 0; j < topKinds.length; j++) {
        const kind = topKinds[j];
        if (!kind || !TOP_LEVEL_KINDS.has(kind) || j === edit.editedTopIndex) continue;
        const span = spans[j];
        if (!span) continue;
        const s = stats.get(kind)!;
        const before = mdLines.slice(span.startLine - 1, span.endLine).join('\n');
        const after = outLines.slice(span.startLine - 1, span.endLine).join('\n');
        s.crossCheckChecked++;
        if (before === after) {
          s.crossCheckPreserved++;
        } else if (!s.exampleMismatch) {
          s.exampleMismatch = `${pf.file.id} seed ${edit.seed}: ${kind} block at lines ${span.startLine}-${span.endLine} changed`;
        }
      }
    }
  }

  return { stats: kinds.map((k) => stats.get(k)!) };
}
