import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdown, serializeDoc, type TraceInfo } from '../src/index.js';

const CORPUS = path.resolve(import.meta.dirname, '../corpus');

test('round trip: every corpus/handwritten/*.md is byte-identical and every top-level block is verbatim', () => {
  const dir = path.join(CORPUS, 'handwritten');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 0, 'expected handwritten corpus files to exist');

  for (const f of files) {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    const { doc } = parseMarkdown(md);
    doc.check();

    const kinds: TraceInfo['kind'][] = [];
    const out = serializeDoc(doc, { trace: (info) => kinds.push(info.kind) });

    assert.equal(out, md, `${f}: round trip must be byte-identical`);
    assert.ok(
      kinds.every((k) => k === 'verbatim'),
      `${f}: every top-level block should take the verbatim path, got [${kinds.join(', ')}]`
    );
  }
});

function corpusSmoke(dirName: string, limit: number) {
  const dir = path.join(CORPUS, 'fetched', dirName);
  if (!fs.existsSync(dir)) {
    throw new Error(`corpus not fetched: run 'node scripts/fetch-corpus.mjs' first (missing ${dir})`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .slice(0, limit);
  assert.ok(files.length > 0, `expected files in ${dir}`);

  const failures: string[] = [];
  for (const f of files) {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      const { doc } = parseMarkdown(md);
      doc.check();
      const out = serializeDoc(doc);
      if (out !== md) failures.push(`${f}: mismatch`);
    } catch (e: any) {
      failures.push(`${f}: ${e.message}`);
    }
  }
  return failures;
}

test('round trip: corpus smoke, first 50 real-world files', () => {
  const failures = corpusSmoke('real', 50);
  assert.deepEqual(failures, [], `failures:\n${failures.join('\n')}`);
});

test('round trip: corpus smoke, first 200 CommonMark spec examples', () => {
  const failures = corpusSmoke('commonmark', 200);
  assert.deepEqual(failures, [], `failures:\n${failures.join('\n')}`);
});
