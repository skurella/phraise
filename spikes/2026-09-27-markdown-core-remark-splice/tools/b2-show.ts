// Show the first differing region of a gate B2 edit: tsx tools/b2-show.ts real/npm-nunjucks-readme:1
import { loadCorpus, corpusFiles } from '../gates/lib/corpus.ts';
import { parseAll } from '../gates/lib/parsedFile.ts';
import { runGateB2One } from '../gates/gateB2.ts';

const [id, seed] = process.argv[2].split(':');
const f = corpusFiles(loadCorpus(false)).find((x) => x.id === id);
if (!f) throw new Error('no file ' + id);
const [pf] = parseAll([f]);
const e = runGateB2One(pf).edits.find((x) => x.seed === Number(seed))!;
const md = f.md, out = e.out ?? '';
let i = 0; while (md[i] === out[i]) i++;
console.log(e.category, e.path, e.word);
console.log('ORIG', JSON.stringify(md.slice(Math.max(0, i - 120), i + 200)));
console.log('OUT ', JSON.stringify(out.slice(Math.max(0, i - 120), i + 200)));
