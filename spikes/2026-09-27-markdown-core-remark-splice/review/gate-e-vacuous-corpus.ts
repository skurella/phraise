// Reviewer probe: same question as gate-e-vacuous.ts but over the real
// corpus, using the gates harness's own loaders, to see how many of the 149
// "non-default, passing" files gates.md reports have zero (or eol-only)
// checkedConventions -- i.e. were never actually verified for the specific
// field that made them "non-default".
import { loadCorpus, corpusFiles } from '../gates/lib/corpus.js';
import { parseAll } from '../gates/lib/parsedFile.js';
import { runGateE } from '../gates/gateE.js';

const sets = loadCorpus(false);
const files = corpusFiles(sets);
const parsed = parseAll(files);
const result = runGateE(parsed);

const nonDefaultPassing = result.files.filter((f) => f.isNonDefault && f.pass);
console.log('non-default & passing files:', nonDefaultPassing.length);

const vacuous = nonDefaultPassing.filter((f) => {
  const meaningful = f.checkedConventions.filter((c) => c !== 'eol');
  return meaningful.length === 0;
});
console.log('of those, with NO non-eol convention actually checked (vacuous pass):', vacuous.length);
for (const f of vacuous.slice(0, 15)) {
  console.log(' -', f.id, 'nonDefaultFields=', f.nonDefaultFields, 'checked=', f.checkedConventions);
}
