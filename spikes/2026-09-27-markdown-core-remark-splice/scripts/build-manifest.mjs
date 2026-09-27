#!/usr/bin/env node
/**
 * Build corpus manifest: fetch npm packages and GitHub design documents.
 * Run from spike directory: node scripts/build-manifest.mjs
 */

import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const SPIKE_DIR = process.cwd();
const CORPUS_DIR = `${SPIKE_DIR}/corpus`;
const MANIFEST_PATH = `${CORPUS_DIR}/manifest.json`;
const SPECS_PATH = `${CORPUS_DIR}/specs.json`;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'phraise-corpus-builder' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function getJsonUrl(url) {
  const text = await httpsGet(url);
  return JSON.parse(text);
}

// Popular npm packages across domains
const NPM_PACKAGES = [
  'express', 'react', 'angular', 'vue', 'svelte', 'next', 'nuxt', 'remix', 'astro',
  'lodash', 'underscore', 'ramda', 'fp-ts',
  'typescript', 'eslint', 'prettier', 'webpack', 'rollup', 'vite', 'esbuild',
  'jest', 'mocha', 'vitest', 'playwright', 'cypress',
  'axios', 'node-fetch', 'got', 'ky',
  'express-validator', 'joi', 'zod', 'yup',
  'socket.io', 'ws', 'mqtt',
  'moment', 'date-fns', 'dayjs', 'chrono-node',
  'chalk', 'cli-table', 'ora', 'inquirer',
  'commander', 'yargs', 'minimist',
  'marked', 'remark', 'unified', 'gray-matter',
  'yaml', 'toml', 'hjson',
  'graphql', 'graphql-core', 'apollo-server', 'relay',
  'openapi-typescript', 'json-schema',
  'multer', 'body-parser', 'compression', 'cors',
  'helmet', 'passport', 'jsonwebtoken',
  'prisma', 'typeorm', 'sequelize', 'knex',
  'redis', 'ioredis', 'memcached',
  'amazon-cognito-identity-js', 'auth0-js',
  'aws-sdk', 'aws-sdk-js-v3', 'stripe',
  'nodemailer', 'sendgrid', 'mailgun-js',
  'sharp', 'jimp', 'canvas',
  'pdf-lib', 'pdfkit',
  'three', 'babylon.js', 'cesium',
  'd3', 'echarts', 'recharts',
  'react-router', 'vue-router',
  'formik', 'react-hook-form',
  'redux', 'zustand', 'jotai', 'recoil',
  'mobx', 'immer',
  'html-to-text', 'jsdom', 'cheerio',
  'puppeteer',
  'semver', 'uuid', 'nanoid',
  'dotenv', 'env-var',
  'debug', 'winston', 'pino', 'bunyan',
  'p-queue', 'bull', 'bee-queue',
  'node-cron', 'agenda', 'node-schedule',
  'glob', 'fast-glob', 'tiny-glob',
  'mkdirp', 'rimraf', 'fs-extra',
  'clipboardy',
  'http-proxy', 'express-http-proxy',
  'archiver', 'unzipper', 'tar',
  'xml2js', 'xmldom',
  'qs', 'query-string', 'url-parse',
  'mime-types', 'file-type',
  'hexo', 'gatsby',
  'electron',
  'expo', 'react-native',
  'nest', 'fastify', 'hapi', 'koa',
  'graphql-request', 'swr', 'react-query',
  'htm', 'preact',
  'vue-test-utils', 'react-testing-library',
  'storybook',
  'ava', 'tap', 'uvu',
  'browserslist', 'caniuse-lite', 'postcss',
  'sass', 'less', 'stylus', 'tailwindcss',
  'bootstrap', 'material-ui', 'chakra-ui',
  'styled-components', 'emotion',
  'react-dom',
  'babel', '@babel/core',
  'swc',
  'mocha-webpack', 'karma',
  'chai', 'sinon', 'nock', 'msw',
  'decimal.js',
  'bcryptjs', 'crypto-js',
  'fast-json-stringify', 'protobufjs',
  'typeorm-cli',
  'pg', 'mysql2', 'better-sqlite3',
  'firebase-admin', 'firebase', 'supabase',
  'jwt-decode', 'base64-js', 'buffer',
  'react-redux', 'redux-thunk',
  'next-auth', 'auth0-react',
  'enzyme', 'react-shallow-renderer',
  'storybook-addon-essentials',
  'husky', 'lint-staged', 'commitlint',
  'semantic-release', 'changesets',
  'lerna', 'turborepo',
  'concurrently', 'npm-run-all', 'wait-on',
  'ts-node', 'nodemon', 'pm2',
  'cross-env',
  'validator',
  'superjson', 'devalue', 'flatted',
  'nanoclone', 'fast-deep-equal',
  'eventemitter3', 'tiny-emitter',
  'p-retry', 'p-timeout',
  'prompts', 'enquirer', 'oclif',
  'pkg', 'vercel', 'netlify-cli',
  'firebase-tools',
  'serverless',
  'nunjucks', 'ejs', 'handlebars',
  'mdx', 'rehype', 'hast',
  'docusaurus', 'vitepress'
];

async function fetchNpmManifest() {
  const entries = [];
  let skipped = 0;

  for (const pkg of NPM_PACKAGES) {
    try {
      const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
      const data = await getJsonUrl(registryUrl);

      const latest = data['dist-tags'].latest;
      if (!latest) continue;

      const version = data.versions[latest];
      if (!version.gitHead || !version.repository) continue;

      const gitHead = version.gitHead;
      const repoUrl = typeof version.repository === 'string'
        ? version.repository
        : version.repository.url?.replace(/\.git$/, '');

      if (!repoUrl || !repoUrl.includes('github.com')) {
        skipped++;
        continue;
      }

      const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+)/);
      if (!match) {
        skipped++;
        continue;
      }

      const [, owner, repo] = match;
      const license = version.license || data.license || 'Unknown';

      // Try README variants
      for (const readmePath of ['README.md', 'Readme.md', 'readme.md']) {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${gitHead}/${readmePath}`;
        try {
          const readmeText = await httpsGet(url);
          const bytes = Buffer.from(readmeText);
          const hash = sha256(bytes);

          entries.push({
            id: `npm-${pkg}-readme`,
            kind: 'readme',
            repo: `${owner}/${repo}`,
            sha: gitHead,
            path: readmePath,
            license,
            url,
            bytes: bytes.length,
            sha256: hash
          });

          console.log(`✓ ${pkg}`);
          break;
        } catch (e) {
          // Try next variant
        }
      }
    } catch (e) {
      skipped++;
    }
  }

  console.log(`\nNPM packages: ${entries.length} fetched, ${skipped} skipped`);
  return entries;
}

async function fetchGitHubDocs() {
  const entries = [];

  const sources = [
    { repo: 'rust-lang/rfcs', path: 'text', count: 30 },
    { repo: 'golang/proposal', path: 'design', count: 25 },
    { repo: 'kubernetes/enhancements', path: 'keps', count: 25 },
    { repo: 'nodejs/node', path: 'doc/api', count: 10 },
    { repo: 'emberjs/rfcs', path: 'text', count: 10 }
  ];

  for (const source of sources) {
    try {
      const [owner, repo] = source.repo.split('/');

      // Get license
      const licenseUrl = `https://api.github.com/repos/${owner}/${repo}`;
      const repoInfo = await getJsonUrl(licenseUrl);
      const license = repoInfo.license?.spdx_id || 'Unknown';

      // Get default branch SHA
      const branchUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${repoInfo.default_branch}`;
      const branchInfo = await getJsonUrl(branchUrl);
      const sha = branchInfo.sha;

      // Get files
      const treesUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
      const treeInfo = await getJsonUrl(treesUrl);

      const mdFiles = treeInfo.tree
        .filter(f => f.path.startsWith(source.path) && f.path.endsWith('.md'))
        .map(f => f.path)
        .sort();

      // Deterministic selection: every k-th
      const k = Math.ceil(mdFiles.length / source.count);
      for (let i = 0; i < mdFiles.length; i += k) {
        const path = mdFiles[i];
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;

        try {
          const content = await httpsGet(url);
          const bytes = Buffer.from(content);
          const hash = sha256(bytes);

          const id = `${owner}-${repo.replace(/[^a-z0-9]/gi, '')}-${path.replace(/[^a-z0-9]/gi, '')}`;
          entries.push({
            id: id.toLowerCase().slice(0, 60),
            kind: 'design-doc',
            repo: `${owner}/${repo}`,
            sha,
            path,
            license,
            url,
            bytes: bytes.length,
            sha256: hash
          });

          console.log(`✓ ${source.repo}:${path.slice(0, 40)}`);
        } catch (e) {
          // Skip unavailable file
        }
      }
    } catch (e) {
      console.log(`✗ ${source.repo}: ${e.message}`);
    }
  }

  console.log(`\nGitHub docs: ${entries.length} fetched`);
  return entries;
}

async function fetchSpecs() {
  const specs = [];

  // CommonMark
  try {
    const url = 'https://raw.githubusercontent.com/commonmark/commonmark-spec/master/spec.txt';
    const content = await httpsGet(url);
    const bytes = Buffer.from(content);

    specs.push({
      id: 'commonmark-spec',
      repo: 'commonmark/commonmark-spec',
      sha: '0.30',
      path: 'spec.txt',
      license: 'CC-BY-SA-4.0',
      url,
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
    console.log('✓ CommonMark spec');
  } catch (e) {
    console.log(`✗ CommonMark: ${e.message}`);
  }

  // GFM
  try {
    const apiUrl = 'https://api.github.com/repos/github/cmark-gfm/commits/master';
    const commitInfo = await getJsonUrl(apiUrl);
    const sha = commitInfo.sha;
    const url = `https://raw.githubusercontent.com/github/cmark-gfm/${sha}/test/spec.txt`;
    const content = await httpsGet(url);
    const bytes = Buffer.from(content);

    specs.push({
      id: 'gfm-spec',
      repo: 'github/cmark-gfm',
      sha,
      path: 'test/spec.txt',
      license: 'BSD-2-Clause',
      url,
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
    console.log('✓ GFM spec');
  } catch (e) {
    console.log(`✗ GFM: ${e.message}`);
  }

  return specs;
}

async function main() {
  console.log('Building corpus manifest...\n');

  const npm = await fetchNpmManifest();
  const github = await fetchGitHubDocs();
  const specs = await fetchSpecs();

  const manifest = [...npm, ...github];

  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(SPECS_PATH, JSON.stringify(specs, null, 2));

  console.log(`\nTotal manifest entries: ${manifest.length}`);
  console.log(`  NPM: ${npm.length}`);
  console.log(`  GitHub: ${github.length}`);
  console.log(`  Specs: ${specs.length}`);

  if (manifest.length < 240 || manifest.length > 280) {
    console.warn(`⚠ Target is 240-280 entries, got ${manifest.length}`);
  } else {
    console.log('✓ Manifest size within target range');
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
