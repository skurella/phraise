// Gate C (charter): "Implement both workarounds for live editing ... Report
// what each costs in code and in constraints on the schema, and whether
// spike 1's serializer still passes its round-trip gate with the changed
// schema on a sample of at least 50 corpus files."
//
// Brief 01 task 7 / plan's common gate harness: two paths, both compared
// against spike 1's own gate A3 (160/294 byte-identical on plain
// y-prosemirror, no codec):
//   (a) server-seeded through the codec (relay's onLoadDocument -> the
//       codec in src/yjs.ts), read by a live editor.
//   (b) loaded client-side into editor 1 through a transaction that
//       replaces the document and sets its attrs (gates/lib/edits.ts's
//       replaceWholeDoc), so the live ySyncPlugin path writes the Yjs doc;
//       read by editor 2 and the relay.
//
// Path (a) needs one live client per file (each file is its own seeded
// document, `file:<relpath>`). Path (b) reuses a single pair of clients
// across every file (one shared docName, `load:sample`, whose content is
// fully replaced each iteration) -- otherwise N files would mean 2N fresh
// websocket handshakes for no reason, since path (b) never depends on
// server-side seeding at all.
import 'global-jsdom/register';
import fs from 'node:fs';
import path from 'node:path';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client.js';
import { parseMarkdown } from '../src/parse.js';
import { serializeDoc } from '../src/serialize.js';
import { replaceWholeDoc } from './lib/edits.js';
import { decodeRelayState } from './lib/equality.js';

export interface GateCFileResult {
  file: string;
  pathA: boolean;
  pathB: boolean;
  errorA?: string;
  errorB?: string;
}

export interface GateCResult {
  pass: boolean;
  total: number;
  pathAPassed: number;
  pathBPassed: number;
  failures: GateCFileResult[];
  elapsedMs: number;
}

async function runPathA(relay: RelayHandle, relpath: string, original: string): Promise<{ ok: boolean; error?: string }> {
  let client: LiveClient | undefined;
  try {
    client = await createLiveClient({ url: relay.wsUrl, docName: `file:${relpath}`, token: 'gateC-a' });
    const out = serializeDoc(client.view.state.doc);
    return out === original ? { ok: true } : { ok: false, error: 'byte mismatch (path A: server-seeded)' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    client?.destroy();
  }
}

async function runPathB(
  relay: RelayHandle,
  loadDocName: string,
  clientB1: LiveClient,
  clientB2: LiveClient,
  original: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { doc } = parseMarkdown(original);
    replaceWholeDoc(clientB1.view, doc);
    await waitUntil(
      () => clientB2.view.state.doc.textContent.length === clientB1.view.state.doc.textContent.length,
      8000,
    );
    const relayBytes = await relay.fetchState(loadDocName);
    const relayDoc = decodeRelayState(relayBytes, { codec: true });
    const outEditor2 = serializeDoc(clientB2.view.state.doc);
    const outRelay = serializeDoc(relayDoc);
    if (outEditor2 !== original) return { ok: false, error: 'byte mismatch (path B: editor 2)' };
    if (outRelay !== original) return { ok: false, error: 'byte mismatch (path B: relay)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function runGateC(opts: {
  port: number;
  dbPath: string;
  corpusDir: string;
  sampleSize?: number;
}): Promise<GateCResult> {
  const start = Date.now();
  const allFiles = fs
    .readdirSync(opts.corpusDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const files = opts.sampleSize ? allFiles.slice(0, opts.sampleSize) : allFiles;

  let relay: RelayHandle | undefined;
  const results: GateCFileResult[] = [];
  try {
    relay = await startRelay({ port: opts.port, db: opts.dbPath, seeds: opts.corpusDir });
    const loadDocName = 'load:sample';
    const [clientB1, clientB2] = await Promise.all([
      createLiveClient({ url: relay.wsUrl, docName: loadDocName, token: 'gateC-b1' }),
      createLiveClient({ url: relay.wsUrl, docName: loadDocName, token: 'gateC-b2' }),
    ]);
    try {
      for (const file of files) {
        const original = fs.readFileSync(path.join(opts.corpusDir, file), 'utf8');
        const [a, b] = await Promise.all([
          runPathA(relay, file, original),
          runPathB(relay, loadDocName, clientB1, clientB2, original),
        ]);
        results.push({ file, pathA: a.ok, pathB: b.ok, errorA: a.error, errorB: b.error });
      }
    } finally {
      clientB1.destroy();
      clientB2.destroy();
    }
  } finally {
    if (relay) await relay.stop();
  }

  const pathAPassed = results.filter((r) => r.pathA).length;
  const pathBPassed = results.filter((r) => r.pathB).length;
  return {
    pass: pathAPassed === results.length && pathBPassed === results.length,
    total: results.length,
    pathAPassed,
    pathBPassed,
    failures: results.filter((r) => !r.pathA || !r.pathB),
    elapsedMs: Date.now() - start,
  };
}
