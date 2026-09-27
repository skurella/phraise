// Origin: adapted from spike 1 (markdown-core-remark-splice), branch
// spike/2026-09-27-markdown-round-trip, commit 1e1f4a6, gates/lib/corpus.ts.
// Brief 01 task 5: "list handwritten and fetched corpus files, read by
// name." Kept spike 1's four-set shape (handwritten/real/commonmark/gfm)
// since scripts/fetch-corpus.mjs (also copied from spike 1) populates all
// four under corpus/fetched/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CorpusSet = 'handwritten' | 'real' | 'commonmark' | 'gfm';

export interface CorpusFile {
  /** Stable id: "<set>/<filename-without-ext>". */
  id: string;
  set: CorpusSet;
  /** Absolute path. */
  path: string;
  md: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
// src/testkit/corpus.ts -> spike root is two levels up.
const SPIKE_DIR = path.resolve(HERE, '../..');
const CORPUS_DIR = path.join(SPIKE_DIR, 'corpus');

const SET_DIRS: Record<CorpusSet, string> = {
  handwritten: path.join(CORPUS_DIR, 'handwritten'),
  real: path.join(CORPUS_DIR, 'fetched', 'real'),
  commonmark: path.join(CORPUS_DIR, 'fetched', 'commonmark'),
  gfm: path.join(CORPUS_DIR, 'fetched', 'gfm'),
};

/** True once `npm run fetch` has populated corpus/fetched/. */
export function corpusFetched(): boolean {
  return fs.existsSync(SET_DIRS.real) && fs.existsSync(SET_DIRS.commonmark) && fs.existsSync(SET_DIRS.gfm);
}

function loadSet(set: CorpusSet): CorpusFile[] {
  const dir = SET_DIRS[set];
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  return files.map((f) => ({
    id: `${set}/${f.replace(/\.md$/, '')}`,
    set,
    path: path.join(dir, f),
    md: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
}

/** Every handwritten corpus file. These always exist (checked into the repo, never fetched). */
export function handwrittenFiles(): CorpusFile[] {
  return loadSet('handwritten');
}

/** Every fetched corpus file across all three fetched sets, or `[]` if not fetched. */
export function fetchedFiles(): CorpusFile[] {
  return [...loadSet('real'), ...loadSet('commonmark'), ...loadSet('gfm')];
}

/** Read a single corpus file by its stable id ("<set>/<name>"), or `undefined` if missing. */
export function corpusFileById(id: string): CorpusFile | undefined {
  const [set] = id.split('/', 1) as [CorpusSet];
  if (!(set in SET_DIRS)) return undefined;
  return loadSet(set).find((f) => f.id === id);
}

/**
 * Load all four corpus sets. `quick`: deterministic subset, every 10th file
 * per set (by sorted filename), for fast iteration.
 */
export function loadCorpus(quick = false): Record<CorpusSet, CorpusFile[]> {
  const sets: Record<CorpusSet, CorpusFile[]> = {
    handwritten: loadSet('handwritten'),
    real: loadSet('real'),
    commonmark: loadSet('commonmark'),
    gfm: loadSet('gfm'),
  };
  if (!quick) return sets;
  const out: Record<CorpusSet, CorpusFile[]> = { handwritten: [], real: [], commonmark: [], gfm: [] };
  for (const set of Object.keys(sets) as CorpusSet[]) {
    out[set] = sets[set].filter((_, i) => i % 10 === 0);
  }
  return out;
}
