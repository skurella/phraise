#!/usr/bin/env npx tsx
// Brief 01, task 8: `npm start`. Builds the page if dist/ is missing, copies
// examples/ into a temporary seeds directory, starts server/main.ts on
// 127.0.0.1:4480 (relay 4481, per the plan's "Ports" choice), and prints the
// address to open. Stops cleanly on Ctrl-C (SIGINT) and SIGTERM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = path.resolve(HERE, '..');
const PORT = 4480;
const RELAY_PORT = 4481;

function listMarkdownFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

async function main(): Promise<void> {
  const distDir = path.join(SPIKE_ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log('dist/ missing or incomplete, building...');
    const build = spawnSync('npx', ['vite', 'build'], { cwd: SPIKE_ROOT, stdio: 'inherit' });
    if (build.status !== 0) {
      console.error('build failed');
      process.exit(build.status ?? 1);
    }
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phraise-web-editor-start-'));
  const seedsDir = path.join(tmpRoot, 'seeds');
  fs.mkdirSync(seedsDir, { recursive: true });
  const examplesDir = path.join(SPIKE_ROOT, 'examples');
  const exampleFiles = listMarkdownFiles(examplesDir);
  for (const file of exampleFiles) {
    fs.copyFileSync(path.join(examplesDir, file), path.join(seedsDir, file));
  }
  const dbPath = path.join(tmpRoot, 'db.sqlite');

  const server = spawn(
    process.execPath,
    ['--import', 'tsx/esm', path.join(SPIKE_ROOT, 'server', 'main.ts'), '--port', String(PORT), '--relay-port', String(RELAY_PORT), '--db', dbPath, '--seeds', seedsDir],
    { cwd: SPIKE_ROOT, stdio: 'inherit' },
  );

  let printedAddress = false;
  const readyTimer = setInterval(() => {
    // server/main.ts prints its own "server-ready" line to stdout (inherited
    // above), so this just prints the friendly address shortly after start;
    // it does not gate on that line since stdio is inherited, not piped.
  }, 1000);
  setTimeout(() => {
    clearInterval(readyTimer);
    if (printedAddress || server.exitCode !== null) return;
    printedAddress = true;
    const first = exampleFiles[0] ?? 'hello.md';
    console.log(`\nOpen http://127.0.0.1:${PORT}/?doc=${encodeURIComponent(first)}&user=Alice\n`);
  }, 500);

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(readyTimer);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGINT');
      await new Promise<void>((resolve) => {
        const escalate = setTimeout(() => server.kill('SIGKILL'), 5000);
        server.once('exit', () => {
          clearTimeout(escalate);
          resolve();
        });
      });
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  server.once('exit', (code) => {
    if (!shuttingDown) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      process.exit(code ?? 0);
    }
  });
}

main().catch((err) => {
  console.error('[start] fatal', err);
  process.exit(1);
});
