#!/usr/bin/env -S npx tsx
// Gates harness entry point. `npm run gates` (full corpus) or
// `npm run gates -- --quick` (deterministic every-10th-file subset).
// See context/plans/2026-09-27-spike-1-brief-03-gates.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCorpus, corpusFetched, corpusFiles, specFiles, type CorpusFile, type CorpusSet } from './lib/corpus.js';
import { parseAll, type ParsedFile } from './lib/parsedFile.js';
import { runGateA, type GateAFileResult } from './gateA.js';
import { runGateB, SEEDS_PER_FILE, type FileWordResult, type EditCategory } from './gateB.js';
import { runGateB2 } from './gateB2.js';
import { runGateC } from './gateC.js';
import { runGateD } from './gateD.js';
import { runGateE } from './gateE.js';
import { renderTable, pct, type GateRow } from './lib/report.js';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..');
const RESULTS_DIR = path.join(SPIKE_DIR, 'results');

const quick = process.argv.includes('--quick');

function ensureCorpus(): void {
  if (corpusFetched()) return;
  console.log('corpus/fetched/ missing; running npm run fetch...');
  execFileSync('node', ['scripts/fetch-corpus.mjs'], { cwd: SPIKE_DIR, stdio: 'inherit' });
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  }
  return m;
}

async function main() {
  const t0 = Date.now();
  ensureCorpus();

  const sets = loadCorpus(quick);
  const allFiles: CorpusFile[] = [...sets.handwritten, ...sets.real, ...sets.commonmark, ...sets.gfm];
  console.log(
    `Loaded corpus${quick ? ' (--quick subset)' : ''}: handwritten=${sets.handwritten.length} real=${sets.real.length} commonmark=${sets.commonmark.length} gfm=${sets.gfm.length}`
  );

  console.log('Parsing...');
  const parsed: ParsedFile[] = parseAll(allFiles);
  const parsedById = new Map(parsed.map((p) => [p.file.id, p]));

  console.log('Running gate A (no-edit round trip, A2 JSON, A3 Yjs)...');
  const gateAResults = runGateA(parsed);
  const gateAById = new Map(gateAResults.map((r) => [r.id, r]));

  console.log(`Running gate B (single-word edit, ${SEEDS_PER_FILE} seeds/file)...`);
  const gateBResults = runGateB(parsed);
  const gateBById = new Map(gateBResults.map((r) => [r.fileId, r]));

  console.log(`Running gate B2 (structural edit: bold toggle, ${SEEDS_PER_FILE} seeds/file, informational)...`);
  const gateB2Results = runGateB2(parsed);

  const corpusParsed = parsed.filter((p) => p.file.set === 'real' || p.file.set === 'handwritten');

  console.log('Running gate C (opaque/special constructs)...');
  const gateC = runGateC(corpusParsed, gateAById, gateBById);

  console.log('Running gate D (editor-model fidelity)...');
  const gateD = runGateD(gateAResults, gateBResults);

  console.log('Running gate E (style detection)...');
  const gateE = runGateE(corpusParsed);

  // -------------------------------------------------------------------------
  // Aggregate gate A / B / D per set.
  // -------------------------------------------------------------------------
  const bySet = groupBy(gateAResults, (r) => (parsedById.get(r.id)!.file.set as CorpusSet));
  const bBySet = groupBy(gateBResults, (r) => r.set);
  const b2BySet = groupBy(gateB2Results, (r) => r.set);

  function setACounts(set: CorpusSet) {
    const rs = bySet.get(set) ?? [];
    return { total: rs.length, ok: rs.filter((r) => r.ok).length, a2: rs.filter((r) => r.a2ok).length, a3: rs.filter((r) => r.a3ok).length };
  }

  function fileWordPass(fw: FileWordResult): boolean {
    return !fw.na && fw.edits.length > 0 && fw.edits.every((e) => e.category === 'ok');
  }

  function wordEditCounts(rs: FileWordResult[]) {
    const withWords = rs.filter((r) => !r.na);
    const na = rs.length - withWords.length;
    const filesPass = withWords.filter(fileWordPass).length;
    const allEdits = withWords.flatMap((r) => r.edits);
    const editsPass = allEdits.filter((e) => e.category === 'ok').length;
    const singleLine = allEdits.filter((e) => e.singleLine).length;
    const pathCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();
    for (const e of allEdits) {
      pathCounts.set(e.path, (pathCounts.get(e.path) ?? 0) + 1);
      catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
    }
    return { totalFiles: rs.length, na, withWords: withWords.length, filesPass, allEdits, editsPass, singleLine, pathCounts, catCounts };
  }

  function setBCounts(set: CorpusSet) {
    return wordEditCounts(bBySet.get(set) ?? []);
  }

  function setB2Counts(set: CorpusSet) {
    return wordEditCounts(b2BySet.get(set) ?? []);
  }

  const corpusA = { total: setACounts('handwritten').total + setACounts('real').total, ok: setACounts('handwritten').ok + setACounts('real').ok };
  const corpusB_hw = setBCounts('handwritten');
  const corpusB_real = setBCounts('real');
  const corpusBFilesPass = corpusB_hw.filesPass + corpusB_real.filesPass;
  const corpusBFilesTotal = corpusB_hw.withWords + corpusB_real.withWords;
  const corpusBEditsPass = corpusB_hw.editsPass + corpusB_real.editsPass;
  const corpusBEditsTotal = corpusB_hw.allEdits.length + corpusB_real.allEdits.length;

  const corpusB2_hw = setB2Counts('handwritten');
  const corpusB2_real = setB2Counts('real');
  const corpusB2FilesPass = corpusB2_hw.filesPass + corpusB2_real.filesPass;
  const corpusB2FilesTotal = corpusB2_hw.withWords + corpusB2_real.withWords;
  const corpusB2EditsPass = corpusB2_hw.editsPass + corpusB2_real.editsPass;
  const corpusB2EditsTotal = corpusB2_hw.allEdits.length + corpusB2_real.allEdits.length;

  // -------------------------------------------------------------------------
  // Results table
  // -------------------------------------------------------------------------
  const rows: GateRow[] = [];

  const gateAPass = corpusA.ok === corpusA.total && corpusA.total > 0;
  rows.push({ gate: 'A. No-edit round trip, corpus files', threshold: '100%', result: pct(corpusA.ok, corpusA.total), pass: gateAPass });

  const gateA2Pass = gateD.a2PassOk === gateD.a2PassTotal;
  rows.push({ gate: 'A2. JSON round trip, all files', threshold: '100%', result: pct(gateD.a2PassOk, gateD.a2PassTotal), pass: gateA2Pass });

  rows.push({
    gate: 'A3. Yjs round trip with plain y-prosemirror, all files (finding)',
    threshold: 'none, measured',
    result: `${pct(gateD.a3PassOk, gateD.a3PassTotal)}, findings: ${gateD.a3DocAttrLossCount} lost doc-level attrs (lead/eol), ${gateD.a3LeafMarkLossCount} lost marks on leaf inline nodes (e.g. linked images)`,
    pass: 'n/a',
  });
  const gateA3bPass = gateD.a3CodecOk === gateD.a3PassTotal;
  rows.push({
    gate: 'A3b. Yjs round trip through src/yjs.ts codec and a binary update, all files',
    threshold: '100%',
    result: pct(gateD.a3CodecOk, gateD.a3PassTotal),
    pass: gateA3bPass,
  });

  const gateBFilePassRate = corpusBFilesTotal ? corpusBFilesPass / corpusBFilesTotal : 0;
  const gateBPass = gateBFilePassRate >= 0.98;
  rows.push({
    gate: 'B. Single-word edit, corpus files (file pass rate)',
    threshold: '98%',
    result: `${pct(corpusBFilesPass, corpusBFilesTotal)} files, ${pct(corpusBEditsPass, corpusBEditsTotal)} edits`,
    pass: gateBPass,
  });

  rows.push({
    gate: 'B2. Structural edit (bold toggle), corpus files (file pass rate; finding)',
    threshold: 'none, measured',
    result: `${pct(corpusB2FilesPass, corpusB2FilesTotal)} files, ${pct(corpusB2EditsPass, corpusB2EditsTotal)} edits`,
    pass: 'n/a',
  });

  const gateCPass = gateC.stats.every((s) => s.filesContaining === 0 || (s.aPassFiles === s.filesContaining && s.crossCheckChecked === s.crossCheckPreserved));
  rows.push({
    gate: 'C. Opaque/special constructs survive A and B',
    threshold: 'every file containing the construct passes A; B containment holds',
    result: gateC.stats.filter((s) => s.filesContaining > 0).map((s) => `${s.kind}:${s.filesContaining}f`).join(', ') || 'none found',
    pass: gateCPass,
  });

  const gateDPass = gateD.schemaIsProseMirrorModel && gateD.docCheckOk === gateD.docCheckTotal && gateD.editedDocCheckOk === gateD.editedDocCheckTotal;
  rows.push({
    gate: 'D. Editor-model fidelity',
    threshold: '100%',
    result: `schema=prosemirror-model:${gateD.schemaIsProseMirrorModel}, doc.check() ${pct(gateD.docCheckOk, gateD.docCheckTotal)}, edited doc.check() ${pct(gateD.editedDocCheckOk, gateD.editedDocCheckTotal)}`,
    pass: gateDPass,
  });

  const gateEPass = gateE.nonDefaultPassCount >= 10;
  rows.push({
    gate: 'E. Style detection, non-default files passing',
    threshold: '>= 10 files',
    result: `${gateE.nonDefaultPassCount} files`,
    pass: gateEPass,
  });

  const allPass = rows.every((r) => r.pass === true || r.pass === 'n/a');

  // -------------------------------------------------------------------------
  // Detail sections
  // -------------------------------------------------------------------------
  const md: string[] = [];
  md.push(`# Gates results${quick ? ' (--quick subset)' : ''}`);
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push('');
  md.push(renderTable(rows));
  md.push('');

  md.push('## Gate A detail (no-edit round trip, per set)');
  md.push('');
  md.push('| Set | Files | A pass | A2 pass | A3 pass |');
  md.push('|---|---|---|---|---|');
  for (const set of ['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]) {
    const c = setACounts(set);
    md.push(`| ${set} | ${c.total} | ${pct(c.ok, c.total)} | ${pct(c.a2, c.total)} | ${pct(c.a3, c.total)} |`);
  }
  md.push('');
  const totalUnstable = gateAResults.reduce((s, r) => s + r.unstableBlocks, 0);
  md.push(`Unstable (self-description-failed) top-level blocks across all files: ${totalUnstable}.`);
  const a3DocAttrLossFiles = gateAResults.filter((r) => r.a3docAttrLoss).map((r) => r.id);
  const a3LeafMarkLossFiles = gateAResults.filter((r) => r.a3leafMarkLoss).map((r) => r.id);
  md.push('');
  md.push(
    `**Finding 1**: gate A3 (Yjs round trip via y-prosemirror's \`prosemirrorToYXmlFragment\`/\`yXmlFragmentToProseMirrorRootNode\`) loses the *doc* node's own top-level attrs (\`lead\`, \`eol\`) -- the XmlFragment has no slot for the root node's own attrs, so they always come back at schema defaults. This affects any file with a non-empty \`lead\` (leading blank lines before the first block) or CRLF line endings. Affected files (${a3DocAttrLossFiles.length}): ${a3DocAttrLossFiles.slice(0, 15).join(', ')}${a3DocAttrLossFiles.length > 15 ? ', ...' : ''}.`
  );
  md.push('');
  md.push(
    `**Finding 2** (more impactful): the same y-prosemirror round trip also silently drops marks on non-text inline leaf nodes -- most commonly the \`link\` mark wrapping an \`image\` node, i.e. \`[![alt](img)](href)\` becomes \`![alt](img)\` (the outer link vanishes). Affected files (${a3LeafMarkLossFiles.length}): ${a3LeafMarkLossFiles.slice(0, 15).join(', ')}${a3LeafMarkLossFiles.length > 15 ? ', ...' : ''}.`
  );
  md.push('');

  md.push('## Gate B detail (single-word edit, per set)');
  md.push('');
  md.push('| Set | Files (n/a) | File pass rate | Edit pass rate | Single-line rate |');
  md.push('|---|---|---|---|---|');
  const failureExamples = new Map<EditCategory, { fileId: string; seed: number; word: string; path: string; excerpt?: string }>();
  for (const set of ['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]) {
    const c = setBCounts(set);
    md.push(
      `| ${set} | ${c.totalFiles} (${c.na} n/a) | ${pct(c.filesPass, c.withWords)} | ${pct(c.editsPass, c.allEdits.length)} | ${pct(c.singleLine, c.allEdits.length)} |`
    );
    for (const e of c.allEdits) {
      if (e.category !== 'ok' && !failureExamples.has(e.category)) {
        failureExamples.set(e.category, { fileId: e.fileId, seed: e.seed, word: e.word, path: e.path, excerpt: e.excerpt });
      }
    }
  }
  md.push('');
  md.push('### Path distribution (all sets, all edits)');
  md.push('');
  const allEditsGlobal = gateBResults.flatMap((r) => r.edits);
  const globalPathCounts = new Map<string, number>();
  const globalCatCounts = new Map<string, number>();
  for (const e of allEditsGlobal) {
    globalPathCounts.set(e.path, (globalPathCounts.get(e.path) ?? 0) + 1);
    globalCatCounts.set(e.category, (globalCatCounts.get(e.category) ?? 0) + 1);
  }
  for (const [k, v] of globalPathCounts) md.push(`- ${k}: ${v}`);
  md.push('');
  md.push('### Failure categories (all sets, with one example each)');
  md.push('');
  for (const [cat, count] of globalCatCounts) {
    if (cat === 'ok') continue;
    const ex = failureExamples.get(cat as EditCategory);
    md.push(`- **${cat}**: ${count}${ex ? ` -- e.g. ${ex.fileId} seed ${ex.seed}, word "${ex.word}", path ${ex.path}${ex.excerpt ? `: \`${ex.excerpt.replace(/\n/g, '\\n')}\`` : ''}` : ''}`);
  }
  md.push('');

  md.push('## Gate B2 detail (structural edit: bold toggle, per set, informational)');
  md.push('');
  md.push('| Set | Files (n/a) | File pass rate | Edit pass rate | Single-line rate |');
  md.push('|---|---|---|---|---|');
  const failureExamplesB2 = new Map<EditCategory, { fileId: string; seed: number; word: string; path: string; excerpt?: string }>();
  for (const set of ['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]) {
    const c = setB2Counts(set);
    md.push(
      `| ${set} | ${c.totalFiles} (${c.na} n/a) | ${pct(c.filesPass, c.withWords)} | ${pct(c.editsPass, c.allEdits.length)} | ${pct(c.singleLine, c.allEdits.length)} |`
    );
    for (const e of c.allEdits) {
      if (e.category !== 'ok' && !failureExamplesB2.has(e.category)) {
        failureExamplesB2.set(e.category, { fileId: e.fileId, seed: e.seed, word: e.word, path: e.path, excerpt: e.excerpt });
      }
    }
  }
  md.push('');
  md.push('### Path distribution (all sets, all edits)');
  md.push('');
  const allEditsGlobalB2 = gateB2Results.flatMap((r) => r.edits);
  const globalPathCountsB2 = new Map<string, number>();
  const globalCatCountsB2 = new Map<string, number>();
  for (const e of allEditsGlobalB2) {
    globalPathCountsB2.set(e.path, (globalPathCountsB2.get(e.path) ?? 0) + 1);
    globalCatCountsB2.set(e.category, (globalCatCountsB2.get(e.category) ?? 0) + 1);
  }
  for (const [k, v] of globalPathCountsB2) md.push(`- ${k}: ${v}`);
  md.push('');
  md.push('### Failure categories (all sets, with one example each)');
  md.push('');
  for (const [cat, count] of globalCatCountsB2) {
    if (cat === 'ok') continue;
    const ex = failureExamplesB2.get(cat as EditCategory);
    md.push(`- **${cat}**: ${count}${ex ? ` -- e.g. ${ex.fileId} seed ${ex.seed}, word "${ex.word}", path ${ex.path}${ex.excerpt ? `: \`${ex.excerpt.replace(/\n/g, '\\n')}\`` : ''}` : ''}`);
  }
  md.push('');

  md.push('## Gate C detail (opaque/special constructs, real + handwritten)');
  md.push('');
  md.push('| Construct | Files containing | Block count | A pass | B file pass rate | Cross-check preserved |');
  md.push('|---|---|---|---|---|---|');
  for (const s of gateC.stats) {
    if (s.filesContaining === 0) continue;
    md.push(
      `| ${s.kind} | ${s.filesContaining} | ${s.blockCount} | ${pct(s.aPassFiles, s.filesContaining)} | ${pct(s.bFilePassFiles, s.filesContaining - s.bFileNaFiles)} | ${pct(s.crossCheckPreserved, s.crossCheckChecked)} |`
    );
  }
  md.push('');

  md.push('## Gate D detail (editor-model fidelity)');
  md.push('');
  md.push(`- Schema is a real \`prosemirror-model\` \`Schema\` instance: ${gateD.schemaIsProseMirrorModel}`);
  md.push(`- \`doc.check()\` on every parsed document: ${pct(gateD.docCheckOk, gateD.docCheckTotal)}`);
  md.push(`- \`doc.check()\` on every gate-B-edited document: ${pct(gateD.editedDocCheckOk, gateD.editedDocCheckTotal)}`);
  md.push(`- Edits made via ProseMirror \`Transaction\`s (\`EditorState.tr.insertText\`): by construction, all of gate B's ${gateD.editedDocCheckTotal} edits.`);
  md.push(`- A2 (JSON round trip) pass rate: ${pct(gateD.a2PassOk, gateD.a2PassTotal)}`);
  md.push(`- A3 (Yjs round trip) pass rate: ${pct(gateD.a3PassOk, gateD.a3PassTotal)} (${gateD.a3DocAttrLossCount} due to finding 1, ${gateD.a3LeafMarkLossCount} due to finding 2 above)`);
  md.push('');

  md.push('## Gate E detail (style detection, real + handwritten)');
  md.push('');
  md.push(`Non-default files that pass the forced-reserialize convention check: ${gateE.nonDefaultPassCount}`);
  md.push('');
  md.push('| File | Non-default conventions | Pass |');
  md.push('|---|---|---|');
  for (const f of gateE.files) {
    if (!f.isNonDefault) continue;
    md.push(`| ${f.id} | ${f.nonDefaultFields.join(', ')} | ${f.pass ? 'yes' : 'no'} |`);
  }
  md.push('');
  md.push(
    `Informational, per top-level block, forced re-serialization (hints on / hints off): byte-identical to \`src\` ${(gateE.hintsOnByteIdenticalRate * 100).toFixed(1)}% / ${(gateE.hintsOffByteIdenticalRate * 100).toFixed(1)}%; semantically-verified re-serialize (not \`unverified\`) ${(gateE.hintsOnVerificationRate * 100).toFixed(1)}% / ${(gateE.hintsOffVerificationRate * 100).toFixed(1)}% (n=${gateE.blocksMeasured} blocks).`
  );
  md.push('');

  const elapsedMs = Date.now() - t0;
  md.push('## Run info');
  md.push('');
  md.push(`- Mode: ${quick ? '--quick (every 10th file)' : 'full corpus'}`);
  md.push(`- Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  md.push('');

  const mdText = md.join('\n') + '\n';
  console.log('\n' + renderTable(rows) + '\n');
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'gates.md'), mdText);

  const json = {
    generatedAt: new Date().toISOString(),
    quick,
    elapsedMs,
    rows,
    setACounts: Object.fromEntries((['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]).map((s) => [s, setACounts(s)])),
    setBCounts: Object.fromEntries(
      (['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]).map((s) => {
        const c = setBCounts(s);
        return [
          s,
          {
            totalFiles: c.totalFiles,
            na: c.na,
            withWords: c.withWords,
            filesPass: c.filesPass,
            editsTotal: c.allEdits.length,
            editsPass: c.editsPass,
            singleLine: c.singleLine,
            pathCounts: Object.fromEntries(c.pathCounts),
            catCounts: Object.fromEntries(c.catCounts),
          },
        ];
      })
    ),
    setB2Counts: Object.fromEntries(
      (['handwritten', 'real', 'commonmark', 'gfm'] as CorpusSet[]).map((s) => {
        const c = setB2Counts(s);
        return [
          s,
          {
            totalFiles: c.totalFiles,
            na: c.na,
            withWords: c.withWords,
            filesPass: c.filesPass,
            editsTotal: c.allEdits.length,
            editsPass: c.editsPass,
            singleLine: c.singleLine,
            pathCounts: Object.fromEntries(c.pathCounts),
            catCounts: Object.fromEntries(c.catCounts),
          },
        ];
      })
    ),
    gateC: gateC.stats,
    gateD,
    gateE: { nonDefaultPassCount: gateE.nonDefaultPassCount, hintsOnByteIdenticalRate: gateE.hintsOnByteIdenticalRate, hintsOffByteIdenticalRate: gateE.hintsOffByteIdenticalRate, hintsOnVerificationRate: gateE.hintsOnVerificationRate, hintsOffVerificationRate: gateE.hintsOffVerificationRate, blocksMeasured: gateE.blocksMeasured, nonDefaultFiles: gateE.files.filter((f) => f.isNonDefault) },
    a3DocAttrLossFiles,
    a3LeafMarkLossFiles,
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'gates.json'), JSON.stringify(json, null, 2) + '\n');

  console.log(`\nWrote ${path.join('results', 'gates.md')} and ${path.join('results', 'gates.json')}.`);

  if (!allPass) {
    console.error('\nOne or more gates missed their threshold.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
