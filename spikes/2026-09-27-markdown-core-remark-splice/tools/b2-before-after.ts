// Brief 04, task 2: gate B2 (structural edit / bold toggle) before and after
// the textblock splice, on the same corpus subset and RNG seeds, using the
// `noTextblockSplice` serialize option to reproduce pre-splice behaviour
// without checking out an earlier commit. Usage:
//   npx tsx tools/b2-before-after.ts            # quick subset
//   npx tsx tools/b2-before-after.ts --full      # full corpus
import { loadCorpus, corpusFiles, specFiles, type CorpusSet } from '../gates/lib/corpus.ts';
import { parseAll } from '../gates/lib/parsedFile.ts';
import { runGateB2, type FileWordResult } from '../gates/gateB2.ts';
import { pct } from '../gates/lib/report.ts';

const quick = !process.argv.includes('--full');
const sets = loadCorpus(quick);
const all = [...corpusFiles(sets), ...specFiles(sets)];
const parsed = parseAll(all);

function summarize(label: string, results: FileWordResult[]) {
  const bySet = new Map<CorpusSet, FileWordResult[]>();
  for (const r of results) bySet.set(r.set, [...(bySet.get(r.set) ?? []), r]);
  console.log(`\n=== ${label} ===`);
  let totalFiles = 0,
    totalPass = 0,
    totalEdits = 0,
    totalEditsPass = 0,
    totalSingleLine = 0;
  const pathCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const set of ['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]) {
    const rs = bySet.get(set) ?? [];
    const withWords = rs.filter((r) => !r.na);
    const filesPass = withWords.filter((r) => r.edits.every((e) => e.category === 'ok')).length;
    const edits = withWords.flatMap((r) => r.edits);
    const editsPass = edits.filter((e) => e.category === 'ok').length;
    const singleLine = edits.filter((e) => e.singleLine).length;
    console.log(`${set}: files ${pct(filesPass, withWords.length)}, edits ${pct(editsPass, edits.length)}, single-line ${pct(singleLine, edits.length)}`);
    if (set === 'handwritten' || set === 'real') {
      totalFiles += withWords.length;
      totalPass += filesPass;
      totalEdits += edits.length;
      totalEditsPass += editsPass;
      totalSingleLine += singleLine;
    }
    for (const e of edits) {
      pathCounts.set(e.path, (pathCounts.get(e.path) ?? 0) + 1);
      catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
    }
  }
  console.log(`corpus files (real+handwritten): files ${pct(totalPass, totalFiles)}, edits ${pct(totalEditsPass, totalEdits)}, single-line ${pct(totalSingleLine, totalEdits)}`);
  console.log('path distribution (all sets):', Object.fromEntries(pathCounts));
  console.log('category distribution (all sets):', Object.fromEntries(catCounts));
}

const before = runGateB2(parsed, { noTextblockSplice: true });
summarize('BEFORE (textblock splice disabled)', before);

const after = runGateB2(parsed);
summarize('AFTER (textblock splice enabled)', after);
