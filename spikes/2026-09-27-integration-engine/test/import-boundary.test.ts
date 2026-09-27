// Brief 01 task 6: "an import-boundary test that scans src/**/*.ts and
// fails if any file outside src/crdt/ imports yjs, y-protocols, lib0 or
// @tiptap/y-tiptap." Plan section 2: "A grep test in test/ enforces that
// only src/crdt/** imports yjs, y-protocols or @tiptap/y-tiptap, and that
// src/relay imports Hocuspocus only" (the src/relay half applies once
// src/relay/ exists, a later brief).
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../src');

const FORBIDDEN = ['yjs', 'y-protocols', 'lib0', '@tiptap/y-tiptap'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  // Matches `import ... from 'x'`, `import 'x'`, and `export ... from 'x'`.
  const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    specifiers.push(m[1] ?? m[2]);
  }
  return specifiers;
}

test('no file outside src/crdt/ imports yjs, y-protocols, lib0 or @tiptap/y-tiptap', () => {
  const files = walk(SRC_DIR).filter((f) => !path.relative(SRC_DIR, f).startsWith('crdt' + path.sep));
  const violations: string[] = [];
  for (const file of files) {
    for (const spec of importsOf(file)) {
      if (FORBIDDEN.some((f) => spec === f || spec.startsWith(f + '/'))) {
        violations.push(`${path.relative(SRC_DIR, file)} imports "${spec}"`);
      }
    }
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

test('the import-boundary test itself has something to scan (sanity: src/crdt exists and imports yjs)', () => {
  const crdtFiles = walk(path.join(SRC_DIR, 'crdt'));
  expect(crdtFiles.length).toBeGreaterThan(0);
  const anyImportsYjs = crdtFiles.some((f) => importsOf(f).some((s) => s === 'yjs'));
  expect(anyImportsYjs).toBe(true);
});
