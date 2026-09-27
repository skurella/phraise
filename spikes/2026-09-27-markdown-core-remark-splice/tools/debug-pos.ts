// Print the positions side table for a file: tsx tools/debug-pos.ts <path>
import { readFileSync } from 'node:fs';
import { parseMarkdown } from '../src/index.ts';
import { findEligibleWords } from '../gates/lib/words.ts';
const { doc, positions } = parseMarkdown(readFileSync(process.argv[2], 'utf8'), { positions: true });
for (const p of positions!) console.log(p.pmStart, doc.nodeAt(p.pmStart)?.type.name, p.startLine, p.endLine, JSON.stringify(doc.nodeAt(p.pmStart)?.textContent.slice(0, 30)));
for (const w of findEligibleWords(doc).slice(0, 400)) if (w.word === process.argv[3]) console.log(w);
