// List every gate B2 (bold toggle) failure on corpus files (real + handwritten), or on a set given as argv[2].
import { loadCorpus, corpusFiles } from '../gates/lib/corpus.ts';
import { parseAll } from '../gates/lib/parsedFile.ts';
import { runGateB2One as runGateBOne } from '../gates/gateB2.ts';

const sets = loadCorpus(false);
const which = process.argv[2];
const files = which ? (sets as any)[which] : corpusFiles(sets);
const cats: Record<string, number> = {};
for (const pf of parseAll(files)) {
  const r = runGateBOne(pf);
  for (const e of r.edits) {
    if (e.category === 'ok') continue;
    cats[e.category + '/' + e.path] = (cats[e.category + '/' + e.path] ?? 0) + 1;
    console.log(`${e.set}/${e.fileId} seed=${e.seed} word=${e.word} cat=${e.category} path=${e.path}`);
    if (process.env.V) console.log('   ', JSON.stringify(e.excerpt ?? e.errorMessage));
  }
}
console.log(cats);
