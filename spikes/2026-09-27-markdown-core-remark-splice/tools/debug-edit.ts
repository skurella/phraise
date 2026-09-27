// Debug gate B edits exactly as the gate chooses them:
//   tsx tools/debug-edit.ts real/npm-foo-readme:3 handwritten/tables:1 ...
import { readFileSync } from 'node:fs';
import { EditorState } from 'prosemirror-state';
import { parseMarkdown, serializeDoc } from '../src/index.ts';
import { parseBlock, buildDefsContextFromDoc } from '../src/parse.ts';
import { findEligibleWords, replacementFor } from '../gates/lib/words.ts';
import { makeRng, pick } from '../gates/lib/prng.ts';

for (const arg of process.argv.slice(2)) {
  const [fileId, seedStr] = arg.split(':');
  const [set, name] = fileId.split('/');
  console.log('===', arg);
  const path = set === 'handwritten' ? `corpus/handwritten/${name}.md` : `corpus/fetched/${set}/${name}.md`;
  const md = readFileSync(path, 'utf8');
  const { doc } = parseMarkdown(md);
  const words = findEligibleWords(doc);
  const chosen = pick(words, makeRng(fileId, Number(seedStr)));
  console.log('chosen', chosen.word, chosen.from, chosen.to);
  const tr = EditorState.create({ doc }).tr.insertText(replacementFor(chosen.word), chosen.from, chosen.to);
  const traces: any[] = [];
  const out = serializeDoc(tr.doc, { onUnverified: 'emit', trace: (t) => traces.push(t) });
  for (const t of traces) if (t.kind !== 'verbatim') console.log('trace', t.kind, t.type);
  const $pos = tr.doc.resolve(chosen.from);
  const top = tr.doc.child($pos.index(0));
  console.log('marks at word', $pos.marks().map((m) => m.type.name + JSON.stringify(m.attrs)));
  const ctx = buildDefsContextFromDoc(tr.doc);
  const { node: old, map } = parseBlock(top.attrs.src, ctx, { map: true });
  const start = old.content.findDiffStart(top.content);
  const end = old.content.findDiffEnd(top.content);
  console.log('diff', start, end);
  for (const r of map ?? []) if (start != null && r.from <= start + 1 && r.to >= start - 1) console.log('run', r.from, r.to, r.literal, r.marks.map((m: any) => m.type.name), JSON.stringify(old.textBetween(r.from, r.to)).slice(0, 160));
  let i = 0; while (md[i] === out[i]) i++;
  console.log('ORIG', JSON.stringify(md.slice(Math.max(0, i - 150), i + 150)));
  console.log('OUT ', JSON.stringify(out.slice(Math.max(0, i - 150), i + 150)));
}
