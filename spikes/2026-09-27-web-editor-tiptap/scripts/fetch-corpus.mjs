#!/usr/bin/env node
/**
 * Fetch corpus files: manifest entries restricted to the ids listed in
 * corpus/needed.json (brief 01, task 6). Copied from spike 5's
 * scripts/fetch-corpus.mjs (branch spike/2026-09-27-collab-stack at
 * eeb3fe2) and trimmed: this spike does not copy corpus/specs.json, so the
 * CommonMark/GFM spec-example fetching that script also did is dropped.
 *
 * Run from the spike directory: node scripts/fetch-corpus.mjs
 */

import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const SPIKE_DIR = process.cwd();
const CORPUS_DIR = `${SPIKE_DIR}/corpus`;
const MANIFEST_PATH = `${CORPUS_DIR}/manifest.json`;
const NEEDED_PATH = `${CORPUS_DIR}/needed.json`;
const FETCHED_DIR = `${CORPUS_DIR}/fetched`;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'phraise-corpus' } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function fetchWithRetry(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await httpsGet(url);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function fetchManifestFile(entry) {
  const filePath = `${FETCHED_DIR}/${entry.id}.md`;

  if (fs.existsSync(filePath)) {
    const bytes = fs.readFileSync(filePath);
    if (sha256(bytes) === entry.sha256) {
      return { status: 'skipped', id: entry.id };
    }
  }

  try {
    const bytes = await fetchWithRetry(entry.url);
    if (sha256(bytes) !== entry.sha256) {
      return { status: 'hash-mismatch', id: entry.id, expected: entry.sha256 };
    }
    fs.mkdirSync(FETCHED_DIR, { recursive: true });
    fs.writeFileSync(filePath, bytes);
    return { status: 'fetched', id: entry.id };
  } catch (e) {
    return { status: 'failed', id: entry.id, error: e.message };
  }
}

async function main() {
  const needed = new Set(JSON.parse(fs.readFileSync(NEEDED_PATH, 'utf8')));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).filter((entry) => needed.has(entry.id));

  const missingIds = [...needed].filter((id) => !manifest.some((entry) => entry.id === id));
  if (missingIds.length > 0) {
    console.error(`corpus/needed.json lists id(s) not found in manifest.json: ${missingIds.join(', ')}`);
    process.exit(1);
  }

  console.log(`Fetching ${manifest.length} corpus file(s) needed by this spike...\n`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  const results = await Promise.all(manifest.map(fetchManifestFile));
  for (const result of results) {
    if (result.status === 'fetched') {
      fetched++;
      console.log(`fetched   ${result.id}`);
    } else if (result.status === 'skipped') {
      skipped++;
      console.log(`skipped   ${result.id} (already present, hash matches)`);
    } else {
      failed++;
      console.log(`FAILED    ${result.id}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
    }
  }

  console.log(`\nSummary: ${fetched} fetched, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) {
    console.error('\nSome files failed to fetch.');
    process.exit(1);
  }
  console.log('\nCorpus ready.');
}

main();
