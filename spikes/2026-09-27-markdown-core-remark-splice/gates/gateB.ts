// Gate B: single-word edit. Threshold: 98% of corpus files (real +
// handwritten combined); commonmark/gfm reported alongside, no threshold.
import { EditorState } from 'prosemirror-state';
import { serializeDoc, parseMarkdown, semanticEq, type TraceInfo } from '../src/index.js';
import { findEligibleWords, replacementFor, posIndex } from './lib/words.js';
import { makeRng, pick } from './lib/prng.js';
import { computeHunks, hunksContained, firstHunkExcerpt } from './lib/diffHunks.js';
import { topLevelSpans, containingTopIndex } from './lib/topSpans.js';
import type { ParsedFile } from './lib/parsedFile.js';
import type { CorpusSet } from './lib/corpus.js';

export const SEEDS_PER_FILE = 5;

export type EditCategory =
  | 'ok'
  | 'semantic-mismatch'
  | 'diff-outside-paragraph-but-inside-block'
  | 'diff-outside-block'
  | 'exception';

export interface EditResult {
  fileId: string;
  set: CorpusSet;
  seed: number;
  word: string;
  path: TraceInfo['kind'] | 'unknown';
  category: EditCategory;
  singleLine: boolean;
  insideEnclosingBlock: boolean;
  editedTopIndex: number;
  out?: string;
  excerpt?: string;
  errorMessage?: string;
}

export interface FileWordResult {
  fileId: string;
  set: CorpusSet;
  na: boolean; // no eligible word in the whole doc
  edits: EditResult[];
}

export function runGateBOne(pf: ParsedFile): FileWordResult {
  const { file, doc } = pf;
  if (pf.error) return { fileId: file.id, set: file.set, na: true, edits: [] };

  const words = findEligibleWords(doc);
  if (words.length === 0) return { fileId: file.id, set: file.set, na: true, edits: [] };

  const byStart = posIndex(pf.positions);
  const spans = topLevelSpans(pf);
  const edits: EditResult[] = [];

  for (let seed = 1; seed <= SEEDS_PER_FILE; seed++) {
    const rng = makeRng(file.id, seed);
    const chosen = pick(words, rng);
    const replacement = replacementFor(chosen.word);
    const editedTopIndex = containingTopIndex(spans, chosen.paragraphPmStart);
    const paraInfo = byStart.get(chosen.paragraphPmStart);
    const blockSpan = editedTopIndex >= 0 ? spans[editedTopIndex] : undefined;

    try {
      const state = EditorState.create({ doc });
      const tr = state.tr.insertText(replacement, chosen.from, chosen.to);
      const newDoc = tr.doc;
      newDoc.check();

      const traces: TraceInfo[] = [];
      const out = serializeDoc(newDoc, { trace: (info) => traces.push(info) });

      let semanticOk = false;
      try {
        const { doc: reparsed } = parseMarkdown(out);
        semanticOk =
          reparsed.childCount === newDoc.childCount &&
          (() => {
            for (let i = 0; i < reparsed.childCount; i++) {
              if (!semanticEq(reparsed.child(i), newDoc.child(i))) return false;
            }
            return true;
          })();
      } catch {
        semanticOk = false;
      }

      const hunks = computeHunks(file.md, out);
      const singleLine = hunks.length === 1 && hunks[0].oldStart === hunks[0].oldEnd;
      const containedPara = paraInfo ? hunksContained(hunks, paraInfo.startLine, paraInfo.endLine) : false;
      const containedBlock = blockSpan ? hunksContained(hunks, blockSpan.startLine, blockSpan.endLine) : false;

      let category: EditCategory;
      if (!semanticOk) category = 'semantic-mismatch';
      else if (containedPara) category = 'ok';
      else if (containedBlock) category = 'diff-outside-paragraph-but-inside-block';
      else category = 'diff-outside-block';

      const path = editedTopIndex >= 0 && editedTopIndex < traces.length ? traces[editedTopIndex].kind : 'unknown';

      edits.push({
        fileId: file.id,
        set: file.set,
        seed,
        word: chosen.word,
        path,
        category,
        singleLine,
        insideEnclosingBlock: containedBlock,
        editedTopIndex,
        out: category === 'ok' ? out : out, // kept for gate C's outside-block byte-identity cross-check
        excerpt: category === 'ok' ? undefined : firstHunkExcerpt(file.md, hunks),
      });
    } catch (e: any) {
      edits.push({
        fileId: file.id,
        set: file.set,
        seed,
        word: chosen.word,
        path: 'unknown',
        category: 'exception',
        singleLine: false,
        insideEnclosingBlock: false,
        editedTopIndex,
        errorMessage: e?.message ?? String(e),
      });
    }
  }

  return { fileId: file.id, set: file.set, na: false, edits };
}

export function runGateB(files: ParsedFile[]): FileWordResult[] {
  return files.map(runGateBOne);
}
