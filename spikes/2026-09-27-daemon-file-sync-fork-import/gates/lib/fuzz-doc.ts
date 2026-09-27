// Gate I (brief 03 task 3): base documents for a fuzz trial -- a real
// corpus README between 2 and 12 KB, or a generated document with headings,
// paragraphs, a list, a code block and a table.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pick, randInt } from './prng.js';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..', '..');
const REAL_DIR = path.join(SPIKE_DIR, 'corpus', 'fetched', 'real');

let realCandidatesCache: string[] | undefined;

function realCandidates(): string[] {
  if (realCandidatesCache) return realCandidatesCache;
  let names: string[] = [];
  try {
    names = fs.readdirSync(REAL_DIR).filter((f) => f.endsWith('.md'));
  } catch {
    names = [];
  }
  realCandidatesCache = names.filter((n) => {
    const size = fs.statSync(path.join(REAL_DIR, n)).size;
    return size >= 2000 && size <= 12000;
  });
  return realCandidatesCache;
}

function generatedDoc(rng: () => number): string {
  const lines: string[] = [];
  lines.push('# Fuzz base document');
  lines.push('');
  lines.push('Paragraph one has some ordinary words in it for editing.');
  lines.push('');
  lines.push('## A section heading');
  lines.push('');
  lines.push('Paragraph two continues the discussion with more words here.');
  lines.push('');
  lines.push('- First list item text');
  lines.push('- Second list item text');
  lines.push('- Third list item text');
  lines.push('');
  lines.push('Paragraph three sits between the list and the code block.');
  lines.push('');
  lines.push('```js');
  lines.push('function example() {');
  lines.push('  return 1;');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('| Col A | Col B |');
  lines.push('| --- | --- |');
  lines.push('| a1 | b1 |');
  lines.push('| a2 | b2 |');
  lines.push('');
  lines.push('Paragraph four wraps up the document with a final thought.');
  lines.push('');
  // A little variety so not every generated trial is byte-identical: extra sentence
  // in paragraph one, seeded off this trial's own rng.
  const extra = randInt(rng, 3);
  if (extra > 0) {
    const idx = lines.indexOf('Paragraph one has some ordinary words in it for editing.');
    lines[idx] = `${lines[idx]} Extra sentence variant ${extra}.`;
  }
  return lines.join('\n') + '\n';
}

/** Picks this trial's base document text: ~50% a real corpus README (2-12KB), else generated. */
export function pickBaseDoc(rng: () => number): { id: string; text: string } {
  const candidates = realCandidates();
  if (candidates.length > 0 && rng() < 0.5) {
    const name = pick(rng, candidates);
    return { id: `real/${name}`, text: fs.readFileSync(path.join(REAL_DIR, name), 'utf8') };
  }
  return { id: 'generated', text: generatedDoc(rng) };
}
