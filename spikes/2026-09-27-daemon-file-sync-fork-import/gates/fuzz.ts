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
// editor's last reload before the insert (orchestrator correction: the
// editor sees remote changes only by reloading, so a delete before the insert
// but after the reload is still concurrent), rather than at or after the
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
import { serializeDoc, yDocToDoc, parseMarkdown, semanticEq } from '../src/md/index.js';
import type { Daemon } from '../src/daemon/daemon.js';
import type { GateOpts, GateResult } from './lib/types.js';

interface TokenRecord {
  token: string;
  insertedBy: 'local' | 'remote';
  insertedAtStep: number;
  /** For local tokens: the step of the editor's last reload before the insert.
   * The editor sees remote changes only by reloading, so a remote whole-block
   * delete at or after this step is concurrent with the insert. */
  editorLoadStep?: number;
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
  baseMisjudged: number;
  wholeDocMismatch: boolean;
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
  const stats = { forks: 0, coarse: 0, repairs: 0, noops: 0, baseMisjudged: 0 };
  const exportedHashes = new Set<string>();
  const harnessWrittenHashes = new Set<string>([hashText(base.text)]);
  const tokens = new Map<string, TokenRecord>();
  const paragraphDeleteEvents: Array<{ step: number }> = [];

  let step = 0;
  let totalSteps = 0;
  let editorBuffer = base.text;
  let lastReloadStep = -1;
  // The text the editor's buffer was derived from (its last reload or its own
  // last save): the true base of its next save. Used to measure base choice.
  let editorBaseHash = hashText(base.text);
  // The editor's lineage since its last reload: the reload's text, then each
  // of its own saves. Saves can coalesce (the daemon sees only the last one of
  // a burst) or land while the daemon is down, so the right base for a save is
  // the newest text in its lineage that the daemon itself has seen.
  // A reload entry counts as seen if the daemon ever saw its text; a save
  // entry only if the daemon saw that text after the save (an undo can
  // recreate an old text the daemon saw long before).
  type LineageEntry = { hash: string; t: number; reload: boolean };
  let editorLineage: LineageEntry[] = [{ hash: hashText(base.text), t: 0, reload: true }];
  const lineageAtSave = new Map<string, LineageEntry[]>();
  const seenAt = new Map<string, number>([[hashText(base.text), 0]]);
  const markSeen = (h: string) => seenAt.set(h, performance.now());
  const wasSeen = (e: LineageEntry) => (e.reload ? seenAt.has(e.hash) : (seenAt.get(e.hash) ?? -1) >= e.t);
  let daemon: Daemon = fx.makeDaemon();
  const client = fx.makeClient();
  let daemonRunning = false;

  let daemonSerial = 0;
  function attachListeners(d: Daemon): void {
    const id = ++daemonSerial;
    if (process.env.FUZZ_DEBUG) {
      for (const ev of ['export', 'export-skip', 'import-noop', 'error', 'detach', 'conflict', 'attach']) {
        d.on(ev, (e: any) => console.error(`  [d${id}] ${ev} at step ${step}: ${JSON.stringify(e).slice(0, 160)}`));
      }
    }
    d.on('import', (e: any) => {
      const lineage = lineageAtSave.get(e.hash);
      const expected = lineage ? [...lineage].reverse().find(wasSeen)?.hash : undefined;
      const baseRight = expected === undefined || expected === e.base;
      markSeen(e.hash);
      if (!baseRight) stats.baseMisjudged++;
      if (process.env.FUZZ_DEBUG) {
        console.error(
          `  import at step ${step}: base ${String(e.base).slice(0, 8)} (${e.baseOrigin}, cost ${e.cost}) ` +
            `expected ${String(expected).slice(0, 8)} ${baseRight ? 'ok' : 'MISJUDGED'} forked=${e.forked}`,
        );
      }
      if (e.forked) stats.forks++;
      if (e.repair) stats.repairs++;
      stats.coarse += e.coarse ?? 0;
      if (exportedHashes.has(e.hash)) {
        echoes.push(`step ${step}: import event replays a hash the daemon itself exported (echo)`);
      } else if (!harnessWrittenHashes.has(e.hash)) {
        echoes.push(`step ${step}: import event's text was never written by the harness (echo)`);
      }
    });
    d.on('import-noop', (e: any) => {
      markSeen(e.hash);
      stats.noops++;
    });
    d.on('export', (e: any) => {
      markSeen(e.hash);
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
        if (editorBuffer !== before) tokens.set(token, { token, insertedBy: 'local', insertedAtStep: step, editorLoadStep: lastReloadStep });
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
        tokens.set(token, { token, insertedBy: 'local', insertedAtStep: step, editorLoadStep: lastReloadStep });
      }
    }
    const style = pick(rng, SAVE_STYLES);
    const savedHash = hashText(editorBuffer);
    harnessWrittenHashes.add(savedHash);
    if (!lineageAtSave.has(savedHash)) lineageAtSave.set(savedHash, [...editorLineage]);
    editorLineage.push({ hash: savedHash, t: performance.now(), reload: false });
    editorBaseHash = savedHash;
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
          editorBaseHash = hashText(editorBuffer);
          editorLineage = [{ hash: editorBaseHash, t: performance.now(), reload: true }];
          lastReloadStep = step;
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
          `step ${step}: ${kind} | editorBase ${editorBaseHash.slice(0, 8)} | client frag len=${client.ydoc.getXmlFragment(FRAGMENT_NAME).length} ` +
            `daemon frag len=${daemon.docSync.doc.getXmlFragment(FRAGMENT_NAME).length} prov=${(daemon as any).provider?.configuration?.websocketProvider?.status} synced=${(daemon as any).provider?.isSynced} started=${(daemon as any).started} detached=${(daemon as any).detached}`,
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
  let wholeDocMismatch = false;

  if (exceptions.length === 0) {
    try {
      const daemonRender = daemon.docSync.render();
      // Whole-document check, reported as its own category: blocks verify in
      // isolation, but some constructs are not compositional (plan 3.5).
      const liveDoc = yDocToDoc(daemon.docSync.doc);
      const reparsed = parseMarkdown(daemonRender).doc;
      if (!semanticEq(liveDoc, reparsed)) {
        wholeDocMismatch = true;
        const a: string[] = [];
        const b: string[] = [];
        liveDoc.forEach((n) => a.push(`${n.type.name}:${n.textContent.slice(0, 40)}`));
        reparsed.forEach((n) => b.push(`${n.type.name}:${n.textContent.slice(0, 40)}`));
        let i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        messages.push(`whole-doc mismatch at top-level block ${i}: doc has ${JSON.stringify(a.slice(i, i + 2))}, file re-parses to ${JSON.stringify(b.slice(i, i + 2))}`);
      }
      const clientRenderedText = serializeDoc(yDocToDoc(client.ydoc));
      if (daemonRender !== clientRenderedText) divergence = true;

      const daemonSv = Buffer.from(Y.encodeStateVector(daemon.docSync.doc));
      const clientSv = Buffer.from(Y.encodeStateVector(client.ydoc));
      if (Buffer.compare(daemonSv, clientSv) !== 0) divergence = true;

      const fileText = readFileSync(fx.repo.file, 'utf8');
      if (fileText !== daemonRender) fileNotRender = true;
      const fileSemanticText = parseMarkdown(fileText).doc.textContent;

      for (const rec of tokens.values()) {
        // Semantic presence: the serializer may escape a character of a token
        // (e.g. `&#x67;` next to intraword emphasis), which is not a loss.
        const present = fileSemanticText.includes(rec.token);
        if (present) {
          if (rec.deletedAtStep !== undefined) {
            resurrected++;
            messages.push(`resurrected: ${rec.token} (deleted by ${rec.deletedBy} at step ${rec.deletedAtStep}, still present)`);
          }
        } else if (rec.deletedAtStep === undefined) {
          const concurrentParaDelete =
            rec.insertedBy === 'local' && paragraphDeleteEvents.some((e) => e.step >= (rec.editorLoadStep ?? 0));
          if (concurrentParaDelete) {
            deleteVsEdit++;
          } else {
            lost++;
            if (process.env.FUZZ_DEBUG) {
              liveDoc.forEach((n, _o, idx) => {
                if (n.textContent.includes(rec.token)) {
                  console.error(`  LOST-BLOCK ${idx} ${n.type.name} src=${JSON.stringify(n.attrs.src)?.slice(0, 300)}`);
                  console.error(`  LOST-JSON ${JSON.stringify(n.toJSON()).slice(0, 1500)}`);
                }
              });
            }
            messages.push(`lost: ${rec.token} (inserted by ${rec.insertedBy} at step ${rec.insertedAtStep}, no delete recorded; in doc text: ${liveDoc.textContent.includes(rec.token)}; in Y xml: ${daemon.docSync.doc.getXmlFragment("prosemirror").toString().includes(rec.token)})`);
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
    detaches.length === 0 &&
    !wholeDocMismatch;

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
    baseMisjudged: stats.baseMisjudged,
    wholeDocMismatch,
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
    wholeDocMismatch: number;
  };
  baseMisjudged: number;
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
    wholeDocMismatch: 0,
  };
  let baseMisjudged = 0;
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
    baseMisjudged += outcome.baseMisjudged; // a measurement of base choice, not a failure by itself

    const failing: string[] = [];
    if (outcome.wholeDocMismatch) {
      categories.wholeDocMismatch++;
      failing.push('whole-doc-mismatch');
    }
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

  return { trials, seedBase, passed, categories, baseMisjudged, forks, coarse, repairs, noops, failingSeeds, outcomes };
}

export function printSummary(summary: FuzzRunSummary): void {
  console.log(`\n=== Gate I: fuzz (${summary.trials} trials, seed base ${summary.seedBase}) ===`);
  console.log(`passed: ${summary.passed}/${summary.trials}`);
  console.log('categories:');
  for (const [k, v] of Object.entries(summary.categories)) console.log(`  ${k}: ${v}`);
  console.log(`base choice: ${summary.baseMisjudged} imports chose a base other than the editor's true base`);
  console.log(`import counters: forks=${summary.forks} coarseTextblocks=${summary.coarse} repairs=${summary.repairs} noops=${summary.noops}`);
  if (summary.failingSeeds.length > 0) {
    console.log(`failing trial seeds (replay with --trials 1 --seed <seed>):`);
    for (const f of summary.failingSeeds.slice(0, 50)) console.log(`  seed ${f.seed}: ${f.categories.join(', ')}`);
    for (const o of summary.outcomes.filter((x) => !x.pass).slice(0, 10)) {
      console.log(`  -- seed ${o.seed} (${o.baseDocId}):`);
      for (const m of o.messages.slice(0, 6)) console.log(`     ${m.split('\n').slice(0, 4).join(' | ')}`);
    }
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
        baseMisjudged: summary.baseMisjudged,
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
