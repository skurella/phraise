// Gate B2: structural edit (bold toggle). Informational only, no threshold
// (see brief 04, task 1). Reuses gate B's word selection and seeds
// (findEligibleWords, the same per-file/per-seed RNG), but instead of
// replacing the word, toggles `strong` on it -- the simplest possible
// "structural" edit: it changes the block's markup (adds `**...**`) rather
// than just its text, which the plain word-replacement splice (gate B)
// cannot express and used to force a full top-level-block re-serialization.
import { EditorState } from 'prosemirror-state';
import { serializeDoc, parseMarkdown, semanticEq, schema, type TraceInfo, type SerializeOpts } from '../src/index.js';
import { findEligibleWords, posIndex } from './lib/words.js';
import { makeRng, pick } from './lib/prng.js';
import { computeHunks, hunksContained, firstHunkExcerpt } from './lib/diffHunks.js';
import { topLevelSpans, containingTopIndex } from './lib/topSpans.js';
import type { ParsedFile } from './lib/parsedFile.js';
import { SEEDS_PER_FILE, type EditCategory, type EditResult, type FileWordResult } from './gateB.js';

export function runGateB2One(pf: ParsedFile, serializeOpts: SerializeOpts = {}): FileWordResult {
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
    const editedTopIndex = containingTopIndex(spans, chosen.paragraphPmStart);
    const paraInfo = byStart.get(chosen.paragraphPmStart);
    const blockSpan = editedTopIndex >= 0 ? spans[editedTopIndex] : undefined;

    try {
      // Toggle: if the word is already (fully) strong, remove it; otherwise add it.
      let alreadyStrong = false;
      doc.nodesBetween(chosen.from, chosen.to, (node) => {
        if (node.isText && node.marks.some((m) => m.type === schema.marks.strong)) alreadyStrong = true;
      });

      const state = EditorState.create({ doc });
      const tr = alreadyStrong
        ? state.tr.removeMark(chosen.from, chosen.to, schema.marks.strong)
        : state.tr.addMark(chosen.from, chosen.to, schema.marks.strong.create());
      const newDoc = tr.doc;
      newDoc.check();

      const traces: TraceInfo[] = [];
      const out = serializeDoc(newDoc, { ...serializeOpts, trace: (info) => traces.push(info) });

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
        out,
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

export function runGateB2(files: ParsedFile[], serializeOpts: SerializeOpts = {}): FileWordResult[] {
  return files.map((pf) => runGateB2One(pf, serializeOpts));
}
