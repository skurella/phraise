// Gate J (brief 04, plan section 6 row J): what the daemon costs on the
// 240 KB real-world file from spike 1 (`corpus/fetched/real/
// nodejs-node-docapinapimd.md`), before and after a verification cache /
// hot-spot pass. Serves D7 and the charter question of whether Node is
// adequate for the daemon.
//
// Run standalone with `npx tsx gates/j.ts [--quick] [--label before|after]`.
// `--label` picks which snapshot file this run's live measurement is written
// to (`results/j-<label>.json`, default `after`): the brief's task 2 records
// the pre-cache numbers with `--label before` (once, before task 3's fixes
// land), and task 4 re-records post-cache numbers with `--label after` (the
// default, also what every later run -- including the wired-in `runGateJ` --
// writes). `runGateJ` always measures the CURRENT code live (this is the
// "after" side, whatever the code happens to be) and, if `results/j-before.json`
// exists, reports it alongside for comparison; it never re-runs the old code,
// since after task 3 the "before" behaviour no longer exists to measure.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as Y from 'yjs';
import { parseMarkdown, parseMdast, serializeDoc, docToYDoc, yDocToDoc } from '../src/md/index.js';
import { DocSync } from '../src/core/docsync.js';
import { chooseBase, hashText, type Version } from '../src/core/versions.js';
import { RemoteEditor } from '../src/testkit/remote-editor.js';
import { saveWithStyle } from '../src/testkit/save-styles.js';
import { makeToken } from '../src/testkit/tokens.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import type { GateOpts, GateResult } from './lib/types.js';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..');
const RESULTS_DIR = path.join(SPIKE_DIR, 'results');
const CORPUS_FILE = path.join(SPIKE_DIR, 'corpus', 'fetched', 'real', 'nodejs-node-docapinapimd.md');

// Median under 500 ms of a fresh-save import plus the resulting export
// (brief 04 task 4's pass criterion).
const IMPORT_PLUS_EXPORT_TARGET_MS = 500;

// ---------------------------------------------------------------------------
// timing helper: `warmup` untimed calls, then `runs` timed calls, median ms.
// `setup()` runs before every call (timed and untimed) and is never itself
// timed, so e.g. building a fresh DocSync per run doesn't pollute the number.
// ---------------------------------------------------------------------------

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timeIt<T>(
  setup: () => T | Promise<T>,
  run: (ctx: T) => void | Promise<void>,
  warmup = 1,
  runs = 5,
): Promise<number> {
  for (let i = 0; i < warmup; i++) {
    const ctx = await setup();
    await run(ctx);
  }
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await setup();
    const t0 = process.hrtime.bigint();
    await run(ctx);
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  return median(samples);
}

// ---------------------------------------------------------------------------
// Text-editing helpers. `chooseBase`/`diffCost` are pure string operations
// (no re-parse), so only the end-to-end and DocSync-level edits below need to
// stay valid Markdown; the chooseBase-candidates helper does not.
// ---------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
}

/** The paragraph (mdast, any depth) closest to `near`, optionally restricted to plain prose (no code/link/emphasis markup) so a word replace can't land on markdown syntax. */
function findParagraphSpan(text: string, near: number, plainOnly: boolean): Span {
  const tree = parseMdast(text);
  const spans: Span[] = [];
  const walk = (node: any) => {
    if (node.type === 'paragraph' && node.position) {
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      const raw = text.slice(start, end);
      if (raw.length > 30 && (!plainOnly || (/^[A-Za-z]/.test(raw) && !/[`*_[\]|<>]/.test(raw)))) {
        spans.push({ start, end });
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(tree);
  if (spans.length === 0) throw new Error('gate J: no suitable paragraph found in corpus file');
  spans.sort((a, b) => Math.abs(a.start - near) - Math.abs(b.start - near));
  return spans[0];
}

/** Replace the first plain word (3+ letters) inside `span` with `token`. */
function replaceFirstWord(text: string, span: Span, token: string): string {
  const seg = text.slice(span.start, span.end);
  const m = /[A-Za-z]{3,}/.exec(seg);
  if (!m) throw new Error('gate J: no word found in chosen paragraph');
  const wordStart = span.start + (m.index as number);
  const wordEnd = wordStart + m[0].length;
  return text.slice(0, wordStart) + token + text.slice(wordEnd);
}

/**
 * The index (document order, any depth -- same counting `RemoteEditor.
 * replaceWord`'s `paragraphIndex` uses) of the first `paragraph` mdast node
 * with at least `minWords` whitespace-separated words. Real prose has plenty
 * of short paragraphs (a one-line intro, a list item), so gate A's own fixed
 * `paragraphIndex 0` can't be assumed here; find one long enough to survive
 * `E2E_N` rounds of `replaceWord(idx, i % 5, token)` without running out of
 * words.
 */
function pickParagraphIndex(text: string, minWords: number): number {
  const tree = parseMdast(text);
  let idx = -1;
  let found = -1;
  const walk = (node: any) => {
    if (found !== -1) return;
    if (node.type === 'paragraph') {
      idx++;
      if (node.position) {
        const raw = text.slice(node.position.start.offset, node.position.end.offset);
        const words = raw.split(/\s+/).filter(Boolean).length;
        if (words >= minWords) {
          found = idx;
          return;
        }
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(tree);
  if (found === -1) throw new Error(`gate J: no paragraph with >= ${minWords} words found`);
  return found;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export interface GateJNumbers {
  parseMarkdownMs: number;
  serializeDocMs: number;
  docToYDocMs: number;
  yDocToDocMs: number;
  importFreshMs: number;
  importStaleForkedMs: number;
  /** Fresh-save import immediately followed by the resulting export, same DocSync: the pass criterion. */
  importPlusExportMs: number;
  renderDetailedMs: number;
  encodeStateAsUpdateMs: number;
  ydocBinBytes: number;
  chooseBase8Ms: number;
  gateALatencyMedianMs: number;
  gateBLatencyMedianMs: number;
  peakRssMb: number;
}

async function measure(_quick: boolean): Promise<GateJNumbers> {
  const corpusText = readFileSync(CORPUS_FILE, 'utf8');
  const warmup = 1;
  const runs = 5; // brief 04 task 1: "median of 5 runs after one warm-up"

  const parseMarkdownMs = await timeIt(
    () => undefined,
    () => {
      parseMarkdown(corpusText);
    },
    warmup,
    runs,
  );

  const parsedDoc = parseMarkdown(corpusText).doc;

  const serializeDocMs = await timeIt(
    () => undefined,
    () => {
      serializeDoc(parsedDoc);
    },
    warmup,
    runs,
  );

  const docToYDocMs = await timeIt(
    () => undefined,
    () => {
      docToYDoc(parsedDoc, new Y.Doc());
    },
    warmup,
    runs,
  );

  const seedYDoc = docToYDoc(parsedDoc, new Y.Doc());
  const yDocToDocMs = await timeIt(
    () => undefined,
    () => {
      yDocToDoc(seedYDoc);
    },
    warmup,
    runs,
  );

  // A one-word edit in the middle of the file: the local editor's save.
  const midSpan = findParagraphSpan(corpusText, corpusText.length / 2, false);
  const editedText = replaceFirstWord(corpusText, midSpan, 'ZZGATEJLOCALEDIT');

  const importFreshMs = await timeIt(
    () => {
      const ds = new DocSync();
      ds.adopt(corpusText);
      return ds;
    },
    (ds) => {
      ds.importText(editedText, { author: { name: 'gate-j', kind: 'local' } });
    },
    warmup,
    runs,
  );

  // Same edit, but as a STALE save: a remote peer touches a different
  // paragraph (index 0) after the editor's base was adopted, forcing
  // `importText` onto the forked (fork-and-merge) path.
  const importStaleForkedMs = await timeIt(
    () => {
      const ds = new DocSync();
      ds.adopt(corpusText);
      new RemoteEditor(ds.doc).replaceWord(0, 0, 'ZZGATEJREMOTE');
      return ds;
    },
    (ds) => {
      ds.importText(editedText, { author: { name: 'gate-j', kind: 'local' } });
    },
    warmup,
    runs,
  );

  // Fresh-save import immediately followed by the resulting export, same
  // DocSync instance: this combined figure is the 500ms pass criterion.
  const importPlusExportMs = await timeIt(
    () => {
      const ds = new DocSync();
      ds.adopt(corpusText);
      return ds;
    },
    (ds) => {
      ds.importText(editedText, { author: { name: 'gate-j', kind: 'local' } });
      ds.renderDetailed();
    },
    warmup,
    runs,
  );

  const renderDetailedMs = await timeIt(
    () => {
      const ds = new DocSync();
      ds.adopt(corpusText);
      new RemoteEditor(ds.doc).replaceWord(0, 0, 'ZZGATEJREMOTE2');
      return ds;
    },
    (ds) => {
      ds.renderDetailed();
    },
    warmup,
    runs,
  );

  const persistDs = new DocSync();
  persistDs.adopt(corpusText);
  new RemoteEditor(persistDs.doc).replaceWord(0, 0, 'ZZGATEJPERSIST');
  const encodeStateAsUpdateMs = await timeIt(
    () => undefined,
    () => {
      Y.encodeStateAsUpdate(persistDs.doc);
    },
    warmup,
    runs,
  );
  const ydocBinBytes = Y.encodeStateAsUpdate(persistDs.doc).length;

  // chooseBase with 8 candidates that differ by one remote edit each.
  // chooseBase/diffCost are pure string operations (no re-parse), so these
  // candidate texts don't need to stay valid Markdown -- only the file-level
  // text (`chainText`, walked once per step by `findParagraphSpan`) does.
  let chainText = corpusText;
  const candidates: Version[] = [];
  for (let i = 0; i < 8; i++) {
    const span = findParagraphSpan(chainText, (chainText.length * (i + 1)) / 9, false);
    chainText = replaceFirstWord(chainText, span, `ZZGATEJV${i}`);
    candidates.push({
      seq: i,
      text: chainText,
      hash: hashText(chainText),
      snapshot: Y.snapshot(new Y.Doc()),
      origin: 'import',
      at: Date.now(),
    });
  }
  const localSaveSpan = findParagraphSpan(chainText, chainText.length / 3, false);
  const localSaveText = replaceFirstWord(chainText, localSaveSpan, 'ZZGATEJLOCAL');
  const chooseBase8Ms = await timeIt(
    () => undefined,
    () => {
      chooseBase(localSaveText, candidates);
    },
    warmup,
    runs,
  );

  // End to end through a real daemon and relay: 10 remote-edit-to-file (gate
  // A shape) and 10 file-save-to-remote (gate B shape) round trips on the
  // 240 KB file, median each.
  const E2E_N = 10;
  const fx = await setupFixture({ content: corpusText, fileName: 'large.md' });
  let gateALatencies: number[] = [];
  let gateBLatencies: number[] = [];
  let peakRssMb = 0;
  try {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    const remoteParagraphIndex = pickParagraphIndex(corpusText, 10);
    for (let i = 0; i < E2E_N; i++) {
      const token = makeToken(`gateJ-remote-${i}`);
      const start = Date.now();
      client.editor.replaceWord(remoteParagraphIndex, i % 5, token);
      await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(token), 15000);
      gateALatencies.push(Date.now() - start);
    }

    const initial = readFileSync(fx.repo.file, 'utf8');
    const span0 = findParagraphSpan(initial, initial.length / 2, true);
    let paraText = initial.slice(span0.start, span0.end);
    const curStart = span0.start;

    for (let i = 0; i < E2E_N; i++) {
      const token = makeToken(`gateJ-local-${i}`);
      const current = readFileSync(fx.repo.file, 'utf8');
      const newParaText = `${paraText} ${token}`;
      const edited = current.slice(0, curStart) + newParaText + current.slice(curStart + paraText.length);
      const start = Date.now();
      await saveWithStyle('in-place', fx.repo.file, edited);
      await waitFor(() => client.editor.currentDoc().textContent.includes(token), 15000);
      gateBLatencies.push(Date.now() - start);
      paraText = newParaText;
    }

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 15000 });
    peakRssMb = process.memoryUsage().rss / (1024 * 1024);
    await daemon.stop();
  } finally {
    await fx.cleanup();
  }

  return {
    parseMarkdownMs,
    serializeDocMs,
    docToYDocMs,
    yDocToDocMs,
    importFreshMs,
    importStaleForkedMs,
    importPlusExportMs,
    renderDetailedMs,
    encodeStateAsUpdateMs,
    ydocBinBytes,
    chooseBase8Ms,
    gateALatencyMedianMs: median(gateALatencies),
    gateBLatencyMedianMs: median(gateBLatencies),
    peakRssMb,
  };
}

function loadJson(file: string): GateJNumbers | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as GateJNumbers;
  } catch {
    return undefined;
  }
}

export async function runGateJ(opts: GateOpts = {}): Promise<GateResult> {
  const after = await measure(opts.quick ?? false);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, 'j-after.json'), JSON.stringify(after, null, 2));

  const before = loadJson(path.join(RESULTS_DIR, 'j-before.json'));
  const numbers: Record<string, unknown> = {};
  const keys = Object.keys(after) as (keyof GateJNumbers)[];
  for (const k of keys) {
    if (before) numbers[`before.${k}`] = before[k];
    numbers[`after.${k}`] = after[k];
  }

  const failures: string[] = [];
  if (!(after.importPlusExportMs < IMPORT_PLUS_EXPORT_TARGET_MS)) {
    failures.push(
      `fresh-save import + export of the 240 KB file: median ${after.importPlusExportMs.toFixed(2)}ms >= ${IMPORT_PLUS_EXPORT_TARGET_MS}ms target`,
    );
  }

  return {
    gate: 'J',
    requirement: `240 KB file: fresh-save import + resulting export under ${IMPORT_PLUS_EXPORT_TARGET_MS}ms median; before/after and end-to-end latencies reported.`,
    pass: failures.length === 0,
    numbers,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Standalone entry: `npx tsx gates/j.ts [--quick] [--label before|after]`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  const labelArg = process.argv.find((a) => a.startsWith('--label='));
  const label = labelArg ? labelArg.slice('--label='.length) : 'after';
  if (label !== 'before' && label !== 'after') {
    throw new Error(`gates/j.ts: --label must be "before" or "after", got ${JSON.stringify(label)}`);
  }

  console.log(`\n--- gate J (large file) ${quick ? '(quick)' : ''}: measuring, label=${label} ---`);
  const numbers = await measure(quick);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, `j-${label}.json`);
  writeFileSync(outFile, JSON.stringify(numbers, null, 2));

  console.log(`\n=== Gate J (${label}) ===`);
  for (const [k, v] of Object.entries(numbers)) {
    console.log(`  ${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`);
  }
  console.log(`\nWrote ${outFile}`);

  const pass = numbers.importPlusExportMs < IMPORT_PLUS_EXPORT_TARGET_MS;
  console.log(
    `\nfresh-save import + export: ${numbers.importPlusExportMs.toFixed(2)}ms median (target < ${IMPORT_PLUS_EXPORT_TARGET_MS}ms) -- ${pass ? 'PASS' : 'FAIL'}`,
  );
}

// Only run when this file is the process entry point (so `runGateJ` can be
// imported by gates/index.ts without re-running `main`); same convention as
// gates/fuzz.ts.
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
