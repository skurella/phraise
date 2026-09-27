// Corpus loading for the gates harness. See ../../corpus/README.md and
// context/plans/2026-09-27-spike-1-brief-03-gates.md.
import fs from 'node:fs';
import path from 'node:path';

export type CorpusSet = 'handwritten' | 'real' | 'commonmark' | 'gfm';

export interface CorpusFile {
  id: string; // stable id: "<set>/<filename-without-ext>"
  set: CorpusSet;
  path: string; // absolute path
  md: string;
}

const SPIKE_DIR = path.resolve(import.meta.dirname, '../..');
const CORPUS_DIR = path.join(SPIKE_DIR, 'corpus');

const SET_DIRS: Record<CorpusSet, string> = {
  handwritten: path.join(CORPUS_DIR, 'handwritten'),
  real: path.join(CORPUS_DIR, 'fetched', 'real'),
  commonmark: path.join(CORPUS_DIR, 'fetched', 'commonmark'),
  gfm: path.join(CORPUS_DIR, 'fetched', 'gfm'),
};

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

/**
 * Load all four corpus sets. `quick`: deterministic subset, every 10th file
 * per set (by sorted filename), for fast iteration.
 */
export function loadCorpus(quick: boolean): Record<CorpusSet, CorpusFile[]> {
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

/** "Corpus files" per the charter: real + handwritten combined, thresholds apply here. */
export function corpusFiles(sets: Record<CorpusSet, CorpusFile[]>): CorpusFile[] {
  return [...sets.handwritten, ...sets.real];
}

/** Spec examples: commonmark + gfm, reported as stress tests, no thresholds. */
export function specFiles(sets: Record<CorpusSet, CorpusFile[]>): CorpusFile[] {
  return [...sets.commonmark, ...sets.gfm];
}
