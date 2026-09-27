// Gate F (plan section 6): core only, no relay. Corpus files with random
// editor-like byte edits, and hand-made half-typed states inserted at
// several positions. Import, then render must equal the saved bytes.
//
// Run with `npx tsx gates/f-roundtrip.ts [--quick]`.
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { DocSync } from '../src/core/docsync.js';
import { parseMarkdown, UnverifiedSerializationError } from '../src/md/index.js';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..');
const CORPUS_DIR = path.join(SPIKE_DIR, 'corpus');
const RESULTS_DIR = path.join(SPIKE_DIR, 'results');

// "insert or delete 1 to 20 characters from the alphabet of letters,
// spaces, newlines and *_`[]()#->|!$~<" (brief 01, task 6).
const ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ \n' + '*_`[]()#->|!$~<';

// --- seeded PRNG: deterministic per corpus file, so a failure reproduces
// on the next run without needing to record the actual random bytes. ---

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stringHashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomEdit(text: string, rng: () => number): string {
  const len = 1 + Math.floor(rng() * 20);
  const doInsert = rng() < 0.5 || text.length === 0;
  if (doInsert) {
    const pos = Math.floor(rng() * (text.length + 1));
    let chars = '';
    for (let i = 0; i < len; i++) chars += ALPHABET[Math.floor(rng() * ALPHABET.length)];
    return text.slice(0, pos) + chars + text.slice(pos);
  }
  const pos = Math.floor(rng() * text.length);
  const delLen = Math.min(len, text.length - pos);
  return text.slice(0, pos) + text.slice(pos + delLen);
}

function excerptDiff(expected: string, actual: string): string {
  let i = 0;
  const n = Math.min(expected.length, actual.length);
  while (i < n && expected[i] === actual[i]) i++;
  const from = Math.max(0, i - 20);
  const esc = (s: string) => s.replace(/\n/g, '\\n');
  return `at char ${i}: expected …${esc(expected.slice(from, i + 40))}… got …${esc(actual.slice(from, i + 40))}…`;
}

// --- corpus loading ---------------------------------------------------

interface CorpusFile {
  id: string;
  kind: 'handwritten' | 'real';
  text: string;
}

function loadCorpus(): CorpusFile[] {
  const out: CorpusFile[] = [];
  const handwrittenDir = path.join(CORPUS_DIR, 'handwritten');
  for (const f of fs
    .readdirSync(handwrittenDir)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    out.push({ id: `handwritten/${f}`, kind: 'handwritten', text: fs.readFileSync(path.join(handwrittenDir, f), 'utf8') });
  }
  const realDir = path.join(CORPUS_DIR, 'fetched', 'real');
  if (fs.existsSync(realDir)) {
    for (const f of fs
      .readdirSync(realDir)
      .filter((f) => f.endsWith('.md'))
      .sort()) {
      out.push({ id: `real/${f}`, kind: 'real', text: fs.readFileSync(path.join(realDir, f), 'utf8') });
    }
  }
  return out;
}

function loadHalfTyped(): Array<{ id: string; text: string }> {
  const raw = JSON.parse(fs.readFileSync(path.join(SPIKE_DIR, 'fixtures', 'half-typed.json'), 'utf8'));
  return raw.states;
}

// --- half-typed insertion positions -------------------------------------

type Position = 'start' | 'between-blocks' | 'end' | 'end-of-line';
const POSITIONS: Position[] = ['start', 'between-blocks', 'end', 'end-of-line'];

function insertionOffset(text: string, position: Position): number | undefined {
  if (position === 'start') return 0;
  if (position === 'end') return text.length;
  if (position === 'between-blocks') {
    const { positions } = parseMarkdown(text, { positions: true });
    if (!positions || positions.length < 2) return undefined;
    return positions[1].source[0];
  }
  // end-of-line: the end of the first non-blank line.
  let offset = 0;
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return offset + line.length;
    offset += line.length + 1;
  }
  return undefined;
}

function pickBaseDocs(corpus: CorpusFile[], n: number): CorpusFile[] {
  const eligible = corpus.filter((c) => {
    if (!/\S/.test(c.text)) return false;
    try {
      const { doc } = parseMarkdown(c.text);
      return doc.childCount >= 2;
    } catch {
      return false;
    }
  });
  return eligible.slice(0, n);
}

// --- gate ----------------------------------------------------------------

interface Failure {
  category: string;
  detail: string;
  excerpt: string;
}

interface FileResult {
  id: string;
  kind: 'handwritten' | 'real';
  roundsRun: number;
  passed: boolean;
  coarseTextblocks: number;
  repairs: number;
  forks: number;
}

function classifyRenderError(e: unknown): { category: string; excerpt: (edited: string) => string } {
  if (e instanceof UnverifiedSerializationError) {
    const category = e.blockIndex === -1 ? 'whole-doc-unverified' : 'block-unverified';
    return { category, excerpt: (edited) => excerptDiff(edited, e.candidate) };
  }
  const message = String((e as Error)?.message ?? e).slice(0, 200);
  return { category: 'render-error', excerpt: () => message };
}

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');

  let corpus = loadCorpus();
  if (quick) corpus = corpus.filter((_, i) => i % 10 === 0);

  const failures: Failure[] = [];
  const fileResults: FileResult[] = [];
  let totalRounds = 0;
  let passedRounds = 0;
  let coarseTotal = 0;
  let repairTotal = 0;
  let forkTotal = 0;
  let noopTotal = 0;

  for (const file of corpus) {
    const ydoc = new Y.Doc({ gc: false });
    const sync = new DocSync(ydoc);
    try {
      sync.adopt(file.text);
    } catch (e) {
      failures.push({ category: 'adopt-error', detail: file.id, excerpt: String((e as Error)?.message ?? e).slice(0, 200) });
      fileResults.push({ id: file.id, kind: file.kind, roundsRun: 0, passed: false, coarseTextblocks: 0, repairs: 0, forks: 0 });
      continue;
    }

    const rng = mulberry32(stringHashSeed(file.id));
    let current = file.text;
    let fileCoarse = 0;
    let fileRepairs = 0;
    let fileForks = 0;
    let filePassed = true;
    let roundsRun = 0;

    for (let round = 0; round < 5; round++) {
      totalRounds++;
      roundsRun++;
      const edited = randomEdit(current, rng);

      let result;
      try {
        result = sync.importText(edited, { author: { name: 'gate-f', kind: 'local' } });
      } catch (e) {
        failures.push({
          category: 'import-error',
          detail: `${file.id} round ${round}`,
          excerpt: String((e as Error)?.message ?? e).slice(0, 200),
        });
        filePassed = false;
        break;
      }

      if (result.kind === 'noop') {
        noopTotal++;
        passedRounds++;
        current = edited;
        continue;
      }
      fileCoarse += result.counters.coarseTextblocks;
      if (result.repaired) fileRepairs++;
      if (result.forked) fileForks++;

      let rendered: string;
      try {
        rendered = sync.render({ wholeDocCheck: true });
      } catch (e) {
        const { category, excerpt } = classifyRenderError(e);
        failures.push({ category, detail: `${file.id} round ${round}`, excerpt: excerpt(edited) });
        filePassed = false;
        break;
      }

      if (rendered !== edited) {
        failures.push({ category: 'render-mismatch', detail: `${file.id} round ${round}`, excerpt: excerptDiff(edited, rendered) });
        filePassed = false;
        break;
      }

      passedRounds++;
      current = edited;
    }

    coarseTotal += fileCoarse;
    repairTotal += fileRepairs;
    forkTotal += fileForks;
    fileResults.push({ id: file.id, kind: file.kind, roundsRun, passed: filePassed, coarseTextblocks: fileCoarse, repairs: fileRepairs, forks: fileForks });
  }

  // --- half-typed states, inserted into base documents at four positions ---

  const fullCorpus = quick ? loadCorpus() : corpus;
  const baseDocs = pickBaseDocs(fullCorpus, quick ? 3 : 10);
  const halfTyped = loadHalfTyped();

  let halfTotal = 0;
  let halfPassed = 0;
  let halfSkipped = 0;

  for (const state of halfTyped) {
    for (const base of baseDocs) {
      for (const position of POSITIONS) {
        const offset = insertionOffset(base.text, position);
        if (offset === undefined) {
          halfSkipped++;
          continue;
        }
        halfTotal++;
        const edited = base.text.slice(0, offset) + state.text + base.text.slice(offset);
        const ydoc = new Y.Doc({ gc: false });
        const sync = new DocSync(ydoc);
        const label = `half-typed "${state.id}" into ${base.id} @ ${position}`;
        try {
          sync.adopt(base.text);
          const result = sync.importText(edited, { author: { name: 'gate-f', kind: 'local' } });
          if (result.kind === 'ok') {
            coarseTotal += result.counters.coarseTextblocks;
            if (result.repaired) repairTotal++;
            if (result.forked) forkTotal++;
          } else {
            noopTotal++;
          }
          const rendered = sync.render({ wholeDocCheck: true });
          if (rendered !== edited) {
            failures.push({ category: 'half-typed-mismatch', detail: label, excerpt: excerptDiff(edited, rendered) });
          } else {
            halfPassed++;
          }
        } catch (e) {
          const { category, excerpt } = classifyRenderError(e);
          failures.push({ category: `half-typed-${category}`, detail: label, excerpt: excerpt(edited) });
        }
      }
    }
  }

  // --- report ---

  const totalChecks = totalRounds + halfTotal;
  const passedChecks = passedRounds + halfPassed;
  const passRate = totalChecks > 0 ? passedChecks / totalChecks : 1;

  console.log('=== Gate F: core round-trip (no relay) ===');
  console.log(`corpus files: ${corpus.length}${quick ? ' (--quick: every 10th)' : ''} (handwritten + real)`);
  console.log(`round-trip rounds: ${passedRounds}/${totalRounds} passed`);
  console.log(
    `half-typed insertions: ${halfPassed}/${halfTotal} passed (${halfSkipped} skipped: no applicable position) ` +
      `[${baseDocs.length} base docs x ${halfTyped.length} states x ${POSITIONS.length} positions]`,
  );
  console.log(`overall pass rate: ${(passRate * 100).toFixed(2)}% (${passedChecks}/${totalChecks})`);
  console.log(`coarse-textblock fallbacks: ${coarseTotal}`);
  console.log(`repairs (whole-fragment fallback after verify mismatch): ${repairTotal}`);
  console.log(`forked imports: ${forkTotal}, noop imports: ${noopTotal}`);
  console.log(`failures: ${failures.length}`);

  const byCategory = new Map<string, number>();
  for (const f of failures) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  for (const [cat, n] of byCategory) console.log(`  ${cat}: ${n}`);

  console.log('\nfirst 20 failures:');
  for (const f of failures.slice(0, 20)) {
    console.log(`  [${f.category}] ${f.detail}: ${f.excerpt}`);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'f-roundtrip.json'),
    JSON.stringify(
      {
        quick,
        corpusFiles: corpus.length,
        totalRounds,
        passedRounds,
        halfTotal,
        halfPassed,
        halfSkipped,
        passRate,
        coarseTotal,
        repairTotal,
        forkTotal,
        noopTotal,
        failureCount: failures.length,
        failuresByCategory: Object.fromEntries(byCategory),
        failures,
        fileResults,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) process.exitCode = 1;
}

main();
