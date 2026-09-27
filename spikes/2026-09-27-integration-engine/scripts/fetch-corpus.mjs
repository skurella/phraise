#!/usr/bin/env node
// Origin: spike 1 (markdown-core-remark-splice), branch
// spike/2026-09-27-markdown-round-trip, commit 1e1f4a6, scripts/fetch-corpus.mjs.
/**
 * Fetch corpus files: manifest entries and spec examples.
 * Run from spike directory: node scripts/fetch-corpus.mjs
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

const SPIKE_DIR = process.cwd();
const CORPUS_DIR = `${SPIKE_DIR}/corpus`;
const MANIFEST_PATH = `${CORPUS_DIR}/manifest.json`;
const SPECS_PATH = `${CORPUS_DIR}/specs.json`;
const FETCHED_DIR = `${CORPUS_DIR}/fetched`;
const REAL_DIR = `${FETCHED_DIR}/real`;
const COMMONMARK_DIR = `${FETCHED_DIR}/commonmark`;
const GFM_DIR = `${FETCHED_DIR}/gfm`;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'phraise-corpus' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function fetchWithRetry(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await httpsGet(url);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function fetchManifestFile(entry) {
  const filePath = `${REAL_DIR}/${entry.id}.md`;

  // Check if file exists with correct hash
  if (fs.existsSync(filePath)) {
    const bytes = fs.readFileSync(filePath);
    if (sha256(bytes) === entry.sha256) {
      return { status: 'skipped', id: entry.id };
    }
  }

  try {
    const bytes = await fetchWithRetry(entry.url);

    // Verify hash
    if (sha256(bytes) !== entry.sha256) {
      return { status: 'hash-mismatch', id: entry.id, expected: entry.sha256 };
    }

    fs.mkdirSync(REAL_DIR, { recursive: true });
    fs.writeFileSync(filePath, bytes);
    return { status: 'fetched', id: entry.id };
  } catch (e) {
    return { status: 'failed', id: entry.id, error: e.message };
  }
}

function extractSpecExamples(content, specName, outDir) {
  const lines = content.split('\n');
  const examples = [];
  let example = null;
  let inMdInput = false;
  let exampleNum = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Start of example: 32+ backticks followed by ' example'
    if (/^`{32,}.*\sexample/.test(line)) {
      if (example) {
        examples.push(example);
      }
      example = { num: exampleNum, markdown: '', start: i };
      inMdInput = true;
      exampleNum++;
      continue;
    }

    // Middle marker: single dot on a line
    if (example && inMdInput && line.trim() === '.') {
      inMdInput = false;
      continue;
    }

    // End of example: 32+ backticks on a line
    if (example && /^`{32,}$/.test(line)) {
      if (example) {
        examples.push(example);
        example = null;
      }
      continue;
    }

    // Collect markdown input
    if (example && inMdInput) {
      // Replace → with tab
      const processedLine = line.replace(/→/g, '\t');
      example.markdown += processedLine + '\n';
    }
  }

  // Write examples
  fs.mkdirSync(outDir, { recursive: true });
  for (const ex of examples) {
    const num = String(ex.num).padStart(4, '0');
    const filePath = `${outDir}/${num}.md`;
    fs.writeFileSync(filePath, ex.markdown);
  }

  return examples.length;
}

async function fetchSpecFiles() {
  const specs = JSON.parse(fs.readFileSync(SPECS_PATH, 'utf8'));
  const results = [];

  for (const spec of specs) {
    try {
      const bytes = await fetchWithRetry(spec.url);

      // Verify hash
      if (sha256(bytes) !== spec.sha256) {
        results.push({ spec: spec.id, status: 'hash-mismatch' });
        continue;
      }

      const outDir = spec.id === 'commonmark-spec' ? COMMONMARK_DIR : GFM_DIR;
      const content = bytes.toString('utf-8');
      const count = extractSpecExamples(content, spec.id, outDir);

      results.push({ spec: spec.id, status: 'fetched', examples: count });
    } catch (e) {
      results.push({ spec: spec.id, status: 'failed', error: e.message });
    }
  }

  return results;
}

async function main() {
  console.log('Fetching corpus...\n');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  // Fetch manifest files with concurrency
  const concurrency = 8;
  let fetched = 0, skipped = 0, failed = 0;

  for (let i = 0; i < manifest.length; i += concurrency) {
    const batch = manifest.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(fetchManifestFile));

    for (const result of results) {
      if (result.status === 'fetched') fetched++;
      else if (result.status === 'skipped') skipped++;
      else if (result.status === 'failed') failed++;
    }

    process.stdout.write(`\rManifest: ${i + batch.length}/${manifest.length}`);
  }

  console.log(`\n\nManifest summary:`);
  console.log(`  Fetched: ${fetched}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);

  // Fetch specs and extract examples
  console.log('\nFetching spec files and examples...');
  const specResults = await fetchSpecFiles();

  let cmCount = 0, gfmCount = 0;
  for (const result of specResults) {
    if (result.status === 'fetched') {
      console.log(`✓ ${result.spec}: ${result.examples} examples`);
      if (result.spec === 'commonmark-spec') cmCount = result.examples;
      if (result.spec === 'gfm-spec') gfmCount = result.examples;
    } else {
      console.log(`✗ ${result.spec}: ${result.status}`);
    }
  }

  console.log(`\nFinal counts:`);
  console.log(`  CommonMark examples: ${cmCount}`);
  console.log(`  GFM examples: ${gfmCount}`);

  // Check for failures
  const hasFailures = failed > 0 || specResults.some(r => r.status === 'failed');
  if (hasFailures) {
    console.error('\n✗ Some files failed to fetch');
    process.exit(1);
  } else {
    console.log('\n✓ Corpus ready');
    process.exit(0);
  }
}

main();
