// Brief 04, task 3: print the most common forced-re-serialization diffs
// (hints on) across the corpus (real + handwritten, or a set given as
// argv[2]), to find cheap fidelity wins in reserializeBlock. For each
// top-level block whose forced reserialize differs from its own `src`,
// print the minimal (removed -> added) span (common prefix/suffix trimmed),
// grouped by that (removed, added) pair so repeated patterns count once.
// Usage: npx tsx tools/top-diffs.ts [set] [--full]
import { loadCorpus, corpusFiles, type CorpusSet } from '../gates/lib/corpus.ts';
import { parseAll } from '../gates/lib/parsedFile.ts';
import { serializeDoc, type TraceInfo } from '../src/index.ts';

const argSet = process.argv[2] && process.argv[2] !== '--full' ? (process.argv[2] as CorpusSet) : undefined;
const quick = !process.argv.includes('--full');
const sets = loadCorpus(quick);
const files = argSet ? sets[argSet] : corpusFiles(sets);
const parsed = parseAll(files);

function minimalDiff(a: string, b: string): { removed: string; added: string } {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { removed: a.slice(p, a.length - s), added: b.slice(p, b.length - s) };
}

const counts = new Map<string, { n: number; removed: string; added: string; type: string; example: string }>();
let blocksMeasured = 0;
let byteIdentical = 0;

for (const pf of parsed) {
  if (pf.error) continue;
  const { doc, file } = pf;
  const srcs: string[] = [];
  doc.forEach((b) => srcs.push((b.attrs.src as string) ?? ''));
  let i = 0;
  try {
    serializeDoc(doc, {
      forceReserialize: true,
      useHints: true,
      trace: (info: TraceInfo) => {
        blocksMeasured++;
        const src = srcs[i] ?? '';
        if (info.text === src) byteIdentical++;
        else {
          const { removed, added } = minimalDiff(src, info.text);
          const key = `${info.type}::${JSON.stringify(removed).slice(0, 60)}=>${JSON.stringify(added).slice(0, 60)}`;
          const entry = counts.get(key);
          if (entry) entry.n++;
          else counts.set(key, { n: 1, removed, added, type: info.type, example: `${file.id}` });
        }
        i++;
      },
    });
  } catch {
    // skip
  }
}

console.log(`blocks measured: ${blocksMeasured}, byte-identical: ${byteIdentical} (${((100 * byteIdentical) / blocksMeasured).toFixed(1)}%)`);
const sorted = [...counts.values()].sort((a, b) => b.n - a.n);
console.log(`distinct diff shapes: ${sorted.length}`);
for (const d of sorted.slice(0, 20)) {
  console.log(`n=${d.n} type=${d.type} example=${d.example}\n  removed=${JSON.stringify(d.removed)}\n  added  =${JSON.stringify(d.added)}`);
}
