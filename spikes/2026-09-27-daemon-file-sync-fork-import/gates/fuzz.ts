// Gate I (plan section 6, brief 03 task 3): seeded randomized trials
// interleaving local saves (all three styles), remote edits, daemon
// restarts and delays. Run standalone with:
//   npx tsx gates/fuzz.ts --trials 300 --seed 1
// A failing trial N (0-based within the run) used seed `<seed> + N`, printed
// per failure, and replays alone with `--trials 1 --seed <that seed>`.
//
// -- Concurrency rule for delete-vs-edit vs lost (brief: "decide concurrency
// conservatively and explain the rule in a comment") --
// Only the remote actor ever deletes a *whole* block in this harness (per
// brief 03 task 3's step list, "occasionally delete a whole paragraph" is a
// remote-only edit kind). So the one race worth naming specially is: the
// local editor inserted a token into ITS OWN buffer (derived from a
// possibly-stale disk read) while, independently, the remote actor deleted
// some whole block from ITS OWN view. Neither side can see the other's
// in-flight edit before the next sync point, so if that local token is
// later missing with no explicit single-token delete ever recorded for it,
// and at least one remote whole-block delete happened at or after the
// token's insertion step, this counts as `delete-vs-edit` rather than
// `lost`. This is deliberately coarse: it does not verify the deleted block
// was actually the token's own paragraph (this harness does not track
// paragraph identity across the two independently-evolving actor views,
// only their token contents), so an unrelated whole-block delete elsewhere
// in the document can also satisfy it. That trades a small amount of
// missed detection (a genuine loss coinciding with an unrelated whole-block
// delete would be under-reported) for a rule simple enough to state and
// verify in a comment, which is what the brief asks for. A token inserted
// by REMOTE is never given this pass: local never deletes whole blocks, so
// there is no matching concurrent event to excuse a remote-inserted token's
// disappearance -- if one goes missing unexplained, it is `lost`.
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import { mulberry32, randInt, pick } from './lib/prng.js';
import { pickBaseDoc } from './lib/fuzz-doc.js';
import {
  localInsertToken,
  localDeleteTokenIfPresent,
  localInsertParagraph,
  remoteInsertToken,
  remoteDeleteTokenIfPresent,
  remoteInsertParagraph,
  remoteDeleteWholeBlock,
} from './lib/fuzz-edits.js';
import { SAVE_STYLES, saveWithStyle } from '../src/testkit/save-styles.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';
import { hashText } from '../src/core/versions.js';
import { serializeDoc, yDocToDoc } from '../src/md/index.js';
import type { Daemon } from '../src/daemon/daemon.js';
import type { GateOpts, GateResult } from './lib/types.js';

interface TokenRecord {
  token: string;
  insertedBy: 'local' | 'remote';
  insertedAtStep: number;
  deletedBy?: 'local' | 'remote';
  deletedAtStep?: number;
}

export interface TrialOutcome {
  seed: number;
  baseDocId: string;
  steps: number;
  pass: boolean;
  exception: boolean;
  divergence: boolean;
  fileNotRender: boolean;
  lost: number;
  deleteVsEdit: number;
  resurrected: number;
  echo: number;
  detach: number;
  forks: number;
  coarse: number;
  repairs: number;
  noops: number;
  messages: string[];
}

/** Runs one seeded fuzz trial end to end. Never throws: any failure is captured in the returned outcome. */
export async function runFuzzTrial(seed: number): Promise<TrialOutcome> {
  const rng = mulberry32(seed);
  const base = pickBaseDoc(rng);
  const fx = await setupFixture({ content: base.text });

  const exceptions: string[] = [];
  const echoes: string[] = [];
  const detaches: string[] = [];
  const messages: string[] = [];
  const stats = { forks: 0, coarse: 0, repairs: 0, noops: 0 };
  const exportedHashes = new Set<string>();
  const harnessWrittenHashes = new Set<string>([hashText(base.text)]);
  const tokens = new Map<string, TokenRecord>();
  const paragraphDeleteEvents: Array<{ step: number }> = [];

  let step = 0;
  let totalSteps = 0;
  let editorBuffer = base.text;
  let daemon: Daemon = fx.makeDaemon();
  const client = fx.makeClient();
  let daemonRunning = false;

  function attachListeners(d: Daemon): void {
    d.on('import', (e: any) => {
      if (e.forked) stats.forks++;
      if (e.repair) stats.repairs++;
      stats.coarse += e.coarse ?? 0;
      if (exportedHashes.has(e.hash)) {
        echoes.push(`step ${step}: import event replays a hash the daemon itself exported (echo)`);
      } else if (!harnessWrittenHashes.has(e.hash)) {
        echoes.push(`step ${step}: import event's text was never written by the harness (echo)`);
      }
    });
    d.on('import-noop', () => {
      stats.noops++;
    });
    d.on('export', (e: any) => {
      exportedHashes.add(e.hash);
    });
    d.on('detach', (e: any) => {
      detaches.push(`step ${step}: detach (${String(e?.reason ?? 'unknown reason')}) -- no git operations run in the fuzz`);
    });
    d.on('conflict', (e: any) => {
      detaches.push(`step ${step}: unexpected conflict event: ${JSON.stringify(e)}`);
    });
    d.on('error', (e: any) => {
      exceptions.push(`step ${step}: daemon error event: ${String(e?.message ?? e)}`);
    });
  }

  async function doEditorEditAndSave(): Promise<void> {
    const numEdits = 1 + randInt(rng, 3);
    for (let i = 0; i < numEdits; i++) {
      const kind = pick(rng, ['insert', 'delete', 'paragraph'] as const);
      if (kind === 'insert') {
        const token = makeToken('localF');
        const before = editorBuffer;
        editorBuffer = localInsertToken(editorBuffer, token, rng);
        if (editorBuffer !== before) tokens.set(token, { token, insertedBy: 'local', insertedAtStep: step });
      } else if (kind === 'delete') {
        const present = tokensIn(editorBuffer);
        if (present.length > 0) {
          const token = pick(rng, present);
          const { text, deleted } = localDeleteTokenIfPresent(editorBuffer, token);
          if (deleted) {
            editorBuffer = text;
            const rec = tokens.get(token);
            if (rec && rec.deletedAtStep === undefined) {
              rec.deletedBy = 'local';
              rec.deletedAtStep = step;
            }
          }
        }
      } else {
        const token = makeToken('localP');
        editorBuffer = localInsertParagraph(editorBuffer, token, rng);
        tokens.set(token, { token, insertedBy: 'local', insertedAtStep: step });
      }
    }
    const style = pick(rng, SAVE_STYLES);
    harnessWrittenHashes.add(hashText(editorBuffer));
    await saveWithStyle(style, fx.repo.file, editorBuffer);
  }

  async function doRemoteEdit(): Promise<void> {
    const r = rng();
    if (r < 0.35) {
      const token = makeToken('remoteF');
      if (remoteInsertToken(client, token, rng)) tokens.set(token, { token, insertedBy: 'remote', insertedAtStep: step });
    } else if (r < 0.65) {
      const present = tokensIn(client.editor.currentDoc().textContent);
      if (present.length > 0) {
        const token = pick(rng, present);
        if (remoteDeleteTokenIfPresent(client, token)) {
          const rec = tokens.get(token);
          if (rec && rec.deletedAtStep === undefined) {
            rec.deletedBy = 'remote';
            rec.deletedAtStep = step;
          }
        }
      }
    } else if (r < 0.9) {
      const token = makeToken('remoteP');
      remoteInsertParagraph(client, token, rng);
      tokens.set(token, { token, insertedBy: 'remote', insertedAtStep: step });
    } else {
      const deletedText = remoteDeleteWholeBlock(client, rng);
      if (deletedText !== undefined) {
        paragraphDeleteEvents.push({ step });
        for (const token of tokensIn(deletedText)) {
          const rec = tokens.get(token);
          if (rec && rec.deletedAtStep === undefined) {
            rec.deletedBy = 'remote';
            rec.deletedAtStep = step;
          }
        }
      }
    }
  }

  async function doRestart(): Promise<void> {
    const graceful = rng() < 0.5;
    await daemon.stop({ persist: graceful });
    daemonRunning = false;
    if (rng() < 0.5) await doRemoteEdit();
    if (rng() < 0.5) await doEditorEditAndSave();
    const next = fx.makeDaemon();
    attachListeners(next);
    await next.start();
    daemon = next;
    daemonRunning = true;
  }

  try {
    attachListeners(daemon);
    await daemon.start();
    daemonRunning = true;
    await client.synced();
    // `client.synced()` only means the CLIENT's own handshake with the relay finished; it
    // does not guarantee the DAEMON's `adopt()` update (sent to the relay slightly earlier,
    // over its own separate websocket) has already arrived and been broadcast back out by
    // the time this second, brand-new connection's sync completes. Losing that race leaves
    // the client's Y.Doc fragment genuinely empty for a moment -- schema-invalid for `doc`'s
    // `block+` content model, so the very first `currentDoc()` call throws. `quiesce()`
    // (state-vector equality, not just "handshake done") closes that gap before any step runs.
    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 5000 });

    totalSteps = 15 + randInt(rng, 16);
    for (step = 0; step < totalSteps; step++) {
      const r = rng();
      let kind = '?';
      if (r < 0.3) {
        kind = 'editor-edit-save';
        await doEditorEditAndSave();
      } else if (r < 0.6) {
        kind = 'remote-edit';
        await doRemoteEdit();
      } else if (r < 0.75) {
        kind = 'delay';
        await new Promise((resolve) => setTimeout(resolve, randInt(rng, 101)));
      } else if (r < 0.85) {
        kind = 'reload';
        try {
          editorBuffer = readFileSync(fx.repo.file, 'utf8');
        } catch {
          // transient (mid-rename save): keep the previous buffer, a real editor would retry.
        }
      } else if (r < 0.95) {
        kind = 'restart';
        await doRestart();
      } else {
        kind = 'quiesce';
        try {
          await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 4000 });
        } catch (err) {
          exceptions.push(`step ${step}: mid-trial quiesce() timed out: ${String((err as Error)?.message ?? err)}`);
        }
      }
      if (process.env.FUZZ_DEBUG) {
        const FRAGMENT_NAME = 'prosemirror';
        console.error(
          `step ${step}: ${kind} | client frag len=${client.ydoc.getXmlFragment(FRAGMENT_NAME).length} ` +
            `daemon frag len=${daemon.docSync.doc.getXmlFragment(FRAGMENT_NAME).length}`,
        );
      }
    }

    if (!daemonRunning) {
      const next = fx.makeDaemon();
      attachListeners(next);
      await next.start();
      daemon = next;
      daemonRunning = true;
    }

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 15000 });
  } catch (err) {
    exceptions.push(`trial threw: ${String((err as Error)?.stack ?? err)}`);
  }

  let divergence = false;
  let fileNotRender = false;
  let lost = 0;
  let deleteVsEdit = 0;
  let resurrected = 0;

  if (exceptions.length === 0) {
    try {
      const daemonRender = daemon.docSync.render({ wholeDocCheck: true });
      const clientRenderedText = serializeDoc(yDocToDoc(client.ydoc));
      if (daemonRender !== clientRenderedText) divergence = true;

      const daemonSv = Buffer.from(Y.encodeStateVector(daemon.docSync.doc));
      const clientSv = Buffer.from(Y.encodeStateVector(client.ydoc));
      if (Buffer.compare(daemonSv, clientSv) !== 0) divergence = true;

      const fileText = readFileSync(fx.repo.file, 'utf8');
      if (fileText !== daemonRender) fileNotRender = true;

      for (const rec of tokens.values()) {
        const present = fileText.includes(rec.token);
        if (present) {
          if (rec.deletedAtStep !== undefined) {
            resurrected++;
            messages.push(`resurrected: ${rec.token} (deleted by ${rec.deletedBy} at step ${rec.deletedAtStep}, still present)`);
          }
        } else if (rec.deletedAtStep === undefined) {
          const concurrentParaDelete =
            rec.insertedBy === 'local' && paragraphDeleteEvents.some((e) => e.step >= rec.insertedAtStep);
          if (concurrentParaDelete) {
            deleteVsEdit++;
          } else {
            lost++;
            messages.push(`lost: ${rec.token} (inserted by ${rec.insertedBy} at step ${rec.insertedAtStep}, no delete recorded)`);
          }
        }
      }
    } catch (err) {
      exceptions.push(`post-trial verification threw: ${String((err as Error)?.message ?? err)}`);
    }
  }

  await daemon.stop({ persist: false }).catch(() => {});
  client.destroy();
  await fx.cleanup();

  const pass =
    exceptions.length === 0 &&
    !divergence &&
    !fileNotRender &&
    lost === 0 &&
    resurrected === 0 &&
    echoes.length === 0 &&
    detaches.length === 0;

  return {
    seed,
    baseDocId: base.id,
    steps: totalSteps,
    pass,
    exception: exceptions.length > 0,
    divergence,
    fileNotRender,
    lost,
    deleteVsEdit,
    resurrected,
    echo: echoes.length,
    detach: detaches.length,
    forks: stats.forks,
    coarse: stats.coarse,
    repairs: stats.repairs,
    noops: stats.noops,
    messages: [...exceptions, ...echoes, ...detaches, ...messages],
  };
}

// ------------------------------------------------------------------ runner

export interface FuzzRunSummary {
  trials: number;
  seedBase: number;
  passed: number;
  categories: {
    exception: number;
    divergence: number;
    fileNotRender: number;
    lost: number;
    deleteVsEdit: number;
    resurrected: number;
    echo: number;
    detach: number;
  };
  forks: number;
  coarse: number;
  repairs: number;
  noops: number;
  failingSeeds: Array<{ seed: number; categories: string[] }>;
  outcomes: TrialOutcome[];
}

export async function runFuzz(trials: number, seedBase: number): Promise<FuzzRunSummary> {
  const categories = {
    exception: 0,
    divergence: 0,
    fileNotRender: 0,
    lost: 0,
    deleteVsEdit: 0,
    resurrected: 0,
    echo: 0,
    detach: 0,
  };
  let forks = 0;
  let coarse = 0;
  let repairs = 0;
  let noops = 0;
  let passed = 0;
  const failingSeeds: Array<{ seed: number; categories: string[] }> = [];
  const outcomes: TrialOutcome[] = [];

  for (let i = 0; i < trials; i++) {
    const seed = seedBase + i;
    const outcome = await runFuzzTrial(seed);
    outcomes.push(outcome);
    forks += outcome.forks;
    coarse += outcome.coarse;
    repairs += outcome.repairs;
    noops += outcome.noops;
    categories.deleteVsEdit += outcome.deleteVsEdit; // always reported, never a failure

    const failing: string[] = [];
    if (outcome.exception) {
      categories.exception++;
      failing.push('exception');
    }
    if (outcome.divergence) {
      categories.divergence++;
      failing.push('divergence');
    }
    if (outcome.fileNotRender) {
      categories.fileNotRender++;
      failing.push('file-not-render');
    }
    if (outcome.lost > 0) {
      categories.lost += outcome.lost;
      failing.push('lost');
    }
    if (outcome.resurrected > 0) {
      categories.resurrected += outcome.resurrected;
      failing.push('resurrected');
    }
    if (outcome.echo > 0) {
      categories.echo += outcome.echo;
      failing.push('echo');
    }
    if (outcome.detach > 0) {
      categories.detach += outcome.detach;
      failing.push('detach');
    }

    if (outcome.pass) passed++;
    else failingSeeds.push({ seed, categories: failing });
  }

  return { trials, seedBase, passed, categories, forks, coarse, repairs, noops, failingSeeds, outcomes };
}

export function printSummary(summary: FuzzRunSummary): void {
  console.log(`\n=== Gate I: fuzz (${summary.trials} trials, seed base ${summary.seedBase}) ===`);
  console.log(`passed: ${summary.passed}/${summary.trials}`);
  console.log('categories:');
  for (const [k, v] of Object.entries(summary.categories)) console.log(`  ${k}: ${v}`);
  console.log(`import counters: forks=${summary.forks} coarseTextblocks=${summary.coarse} repairs=${summary.repairs} noops=${summary.noops}`);
  if (summary.failingSeeds.length > 0) {
    console.log(`failing trial seeds (replay with --trials 1 --seed <seed>):`);
    for (const f of summary.failingSeeds.slice(0, 50)) console.log(`  seed ${f.seed}: ${f.categories.join(', ')}`);
    if (summary.failingSeeds.length > 50) console.log(`  ... and ${summary.failingSeeds.length - 50} more`);
  }
}

// ---------------------------------------------------------------------- CLI

const DEFAULT_SEED_BASE = 0x1a2b3c4d;

function parseArgs(argv: string[]): { trials: number; seed: number } {
  let trials = 300;
  let seed = DEFAULT_SEED_BASE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trials') trials = Number(argv[++i]);
    else if (argv[i] === '--seed') seed = Number(argv[++i]);
  }
  return { trials, seed };
}

async function main(): Promise<void> {
  const { trials, seed } = parseArgs(process.argv.slice(2));
  const summary = await runFuzz(trials, seed);
  printSummary(summary);

  const fs = await import('node:fs');
  const path = await import('node:path');
  const resultsDir = path.join(path.resolve(import.meta.dirname, '..'), 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'fuzz.json'),
    JSON.stringify(
      {
        trials: summary.trials,
        seedBase: summary.seedBase,
        passed: summary.passed,
        categories: summary.categories,
        forks: summary.forks,
        coarse: summary.coarse,
        repairs: summary.repairs,
        noops: summary.noops,
        failingSeeds: summary.failingSeeds,
      },
      null,
      2,
    ),
  );

  if (summary.passed !== summary.trials) process.exitCode = 1;
}

// Only run the CLI when this module is the entry point (not when `gates/index.ts` imports `runFuzz`).
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
