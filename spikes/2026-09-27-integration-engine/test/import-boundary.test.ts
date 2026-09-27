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

test('src/git imports nothing from src/crdt (brief 02: git is standalone, no Yjs knowledge)', () => {
  const gitDir = path.join(SRC_DIR, 'git');
  const gitFiles = walk(gitDir);
  expect(gitFiles.length).toBeGreaterThan(0);
  const violations: string[] = [];
  for (const file of gitFiles) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) continue; // only a relative specifier can resolve into src/crdt
      const resolved = path.resolve(path.dirname(file), spec);
      const relFromSrc = path.relative(SRC_DIR, resolved);
      if (relFromSrc === 'crdt' || relFromSrc.startsWith('crdt' + path.sep)) {
        violations.push(`${path.relative(SRC_DIR, file)} imports "${spec}" (resolves into src/crdt)`);
      }
    }
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

test('src/relay only imports @hocuspocus/server and @hocuspocus/extension-sqlite from the hocuspocus family, and never yjs itself (brief 04, plan section 2: "the relay calls only engine, git and the opaque crdt handles; it never calls Yjs APIs")', () => {
  const relayDir = path.join(SRC_DIR, 'relay');
  const files = walk(relayDir);
  expect(files.length).toBeGreaterThan(0);
  const allowedHocuspocus = new Set(['@hocuspocus/server', '@hocuspocus/extension-sqlite']);
  const violations: string[] = [];
  for (const file of files) {
    for (const spec of importsOf(file)) {
      if (spec.startsWith('@hocuspocus/') && !allowedHocuspocus.has(spec)) {
        violations.push(`${path.relative(SRC_DIR, file)} imports "${spec}" (only @hocuspocus/server and @hocuspocus/extension-sqlite are allowed)`);
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
