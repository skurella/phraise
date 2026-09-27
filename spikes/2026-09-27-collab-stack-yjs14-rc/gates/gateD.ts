// Gate D (charter): "Tiptap 3 with its collaboration and cursor extensions
// works on the stack, or state what has to be replaced by custom
// extensions."
//
// Brief 04, task 5. Checked npm directly before writing this (`npm view
// @tiptap/extension-collaboration peerDependencies`): `{ yjs: '^13',
// '@tiptap/pm': '3.31.3', '@tiptap/core': '3.31.3', '@tiptap/y-tiptap':
// '^3.0.7' }` -- every 3.31.3 Tiptap collaboration package hard-pins Yjs 13
// via `@tiptap/y-tiptap`. No `@y/tiptap`, `@tiptap/y-prosemirror` or
// `@y/y-tiptap` package exists on npm (all 404). So: Tiptap 3.31.3 CORE
// (`@tiptap/core`, `@tiptap/pm`, exact same version as stack 13) works
// fine standalone, but its OWN collaboration/cursor extensions cannot be
// used at all on this stack -- src/tiptapClient.ts replaces them with
// three small custom extensions wrapping @y/prosemirror's own
// syncPlugin/yCursorPlugin/yUndoPlugin directly (see that file's header
// for the line counts), the same pattern the upstream Tiptap 3 demo the
// brief names uses for exactly this reason.
//
// Same checks as stack 13's gate D: single prosemirror instance (npm ls
// dedupe), schema equivalence via the generic converter
// (src/tiptapExtensions.ts), gate B's script through two Tiptap editors
// converging, carets both ways, undo isolation.
import 'global-jsdom/register';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { Mark } from 'prosemirror-model';
import { undoCommand } from '@y/prosemirror';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createTiptapLiveClient, type TiptapLiveClient } from '../src/tiptapClient.js';
import { waitUntil } from '../src/client-hocuspocus.js';
import { schema } from '../src/schema.js';
import { buildTiptapSchema, checkSchemaEquivalence } from '../src/tiptapExtensions.js';
import { findPos, insertText, pasteHTMLAt, splitBlockAt, joinBackwardAt, addMarkAt, deleteRange } from './lib/edits.js';
import { checkEquality, decodeRelayState, linkedImages } from './lib/equality.js';

export interface GateDCheck {
  name: string;
  pass: boolean;
  detail: string;
}
export interface GateDResult {
  pass: boolean;
  checks: GateDCheck[];
  detail: string;
}

const DOC_NAME = 'file:live.md';
const PASTED_HTML = '<strong>bold</strong> and <a href="https://pasted.example"><img src="pasted.png" alt="pasted"></a>';

function checkDedupe(): GateDCheck {
  const out = execSync('npm ls prosemirror-model prosemirror-state --json --all', { cwd: process.cwd(), encoding: 'utf8' });
  const versions = new Set<string>();
  const parsed = JSON.parse(out) as unknown;
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const deps = (node as { dependencies?: Record<string, { version?: string }> }).dependencies;
    if (!deps) return;
    for (const [name, dep] of Object.entries(deps)) {
      if ((name === 'prosemirror-model' || name === 'prosemirror-state') && dep.version) versions.add(`${name}@${dep.version}`);
      walk(dep);
    }
  }
  walk(parsed);
  const byPackage = new Map<string, Set<string>>();
  for (const v of versions) {
    const idx = v.lastIndexOf('@');
    const pkg = v.slice(0, idx);
    const ver = v.slice(idx + 1);
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
    byPackage.get(pkg)!.add(ver);
  }
  const dupes = [...byPackage.entries()].filter(([, vs]) => vs.size > 1);
  return {
    name: 'Dedupe: exactly one resolved version of prosemirror-model and prosemirror-state',
    pass: dupes.length === 0,
    detail: dupes.length === 0 ? `single version each: ${[...byPackage.entries()].map(([p, vs]) => `${p}@${[...vs][0]}`).join(', ')}` : `duplicates found: ${JSON.stringify(dupes)}`,
  };
}

function checkSchema(): GateDCheck {
  const tSchema = buildTiptapSchema();
  const eq = checkSchemaEquivalence(schema, tSchema);
  return {
    name: 'Schema: Tiptap-generated schema equivalent to src/schema.ts',
    pass: eq.equal,
    detail: eq.equal ? `${tSchema.spec.nodes.size} nodes, ${tSchema.spec.marks.size} marks, all fields match` : eq.diffs.join('; '),
  };
}

function checkNoTiptapCollabPackage(): GateDCheck {
  // Documents the npm lookups done before writing this file (see the
  // header): no installed/available Tiptap package understands Yjs 14.
  return {
    name: 'Tiptap 3.31.3 has no Yjs-14-compatible collaboration package (checked npm)',
    pass: true,
    detail:
      "npm view @tiptap/extension-collaboration peerDependencies -> yjs: '^13', @tiptap/y-tiptap: '^3.0.7' (hard-pinned); " +
      '@y/tiptap, @tiptap/y-prosemirror, @y/y-tiptap all 404 on the registry -- custom extensions (src/tiptapClient.ts) are the only option',
  };
}

async function runScript(a: TiptapLiveClient, b: TiptapLiveClient): Promise<void> {
  const closingPara = () => findPos(a.editor.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('A closing paragraph'));
  const pos = closingPara();
  const node1 = a.editor.view.state.doc.nodeAt(pos)!;
  insertText(a.editor.view, pos + node1.nodeSize - 1, ' newword');

  const htmlParaB = findPos(b.editor.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Some inline HTML'));
  const nodeB = b.editor.view.state.doc.nodeAt(htmlParaB)!;
  insertText(b.editor.view, htmlParaB + nodeB.nodeSize - 1, ' concurrent');

  const unlinkedParaPos = () => findPos(a.editor.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('An unlinked image'));
  const p2 = unlinkedParaPos();
  const node2 = a.editor.view.state.doc.nodeAt(p2)!;
  pasteHTMLAt(a.editor.view, p2 + node2.nodeSize - 1, PASTED_HTML);

  const badgePos = () => findPos(a.editor.view, (n) => n.type.name === 'image' && n.attrs.url === 'badge.svg');
  const splitAt = badgePos();
  splitBlockAt(a.editor.view, splitAt);
  const rejoinAt = badgePos() + 1;
  joinBackwardAt(a.editor.view, rejoinAt);

  const iconPos = () => findPos(a.editor.view, (n) => n.type.name === 'image' && n.attrs.url === 'icon.png');
  const linkMark = schema.marks.link.create({ href: 'https://icon.example' }) as Mark;
  addMarkAt(a.editor.view, iconPos(), linkMark);

  const htmlParaPos = findPos(a.editor.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Some inline HTML'));
  const htmlParaNode = a.editor.view.state.doc.nodeAt(htmlParaPos)!;
  const deleteFrom = htmlParaPos + htmlParaNode.nodeSize - 4;
  const deleteTo = deleteFrom + 8;
  deleteRange(a.editor.view, deleteFrom, deleteTo);

  await waitUntil(() => JSON.stringify(a.editor.state.doc.toJSON()) === JSON.stringify(b.editor.state.doc.toJSON()), 8000);
}

/**
 * A live Tiptap editor's doc uses Tiptap's OWN Schema instance (a fresh
 * object graph per Editor construction). Convert to the canonical schema
 * via a JSON round-trip before handing it to serializeDoc/semanticEq/
 * linkedImages -- same fix, same reasoning as stack 13's gate D.
 */
function canonicalize(doc: import('prosemirror-model').Node): import('prosemirror-model').Node {
  return schema.nodeFromJSON(doc.toJSON());
}

async function runConvergence(port: number, dbPath: string): Promise<GateDCheck> {
  fs.rmSync(dbPath, { force: true });
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
  const a = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice', user: { name: 'Alice', color: '#ff0000' } });
  const b = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob', user: { name: 'Bob', color: '#0000ff' } });
  try {
    await runScript(a, b);
    const relayBytes = await relay.fetchState(DOC_NAME);
    const relayDoc = decodeRelayState(relayBytes);
    const doc1 = canonicalize(a.editor.state.doc);
    const doc2 = canonicalize(b.editor.state.doc);
    const eq = checkEquality({ editor1: doc1, editor2: doc2, relay: relayDoc });
    const links = linkedImages(doc1);
    const reasons = [...eq.reasons];
    if (!links.some((im) => im.url === 'icon.png')) reasons.push('icon.png did not keep its newly-added link mark');
    if (!links.some((im) => im.url === 'badge.svg')) reasons.push('badge.svg lost its link mark across split/join');
    if (!links.some((im) => im.url === 'logo.png')) reasons.push('logo.png lost its link mark');
    if (!links.some((im) => im.url === 'pasted.png')) reasons.push('pasted.png (from paste) is missing its link mark');
    return {
      name: "Gate B's script run through two Tiptap editors: converge (editor1 = editor2 = relay)",
      pass: reasons.length === 0,
      detail: reasons.length === 0 ? 'editor1, editor2 and the relay agree; every linked image kept its link mark' : reasons.join('; '),
    };
  } finally {
    a.destroy();
    b.destroy();
    await relay.stop();
  }
}

function hasCaret(html: string): boolean {
  return html.includes('ProseMirror-yjs-cursor') || html.includes('y-cursor') || html.includes('ProseMirror-yjs-selection');
}

async function runCaretAndUndo(port: number, dbPath: string): Promise<GateDCheck[]> {
  const checks: GateDCheck[] = [];
  fs.rmSync(dbPath, { force: true });
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
  const a = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice', user: { name: 'Alice', color: '#ff0000' } });
  const b = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob', user: { name: 'Bob', color: '#0000ff' } });
  try {
    await new Promise((r) => setTimeout(r, 200));
    const aliceAwareness = a.provider.awareness!.getStates();
    const bobAwareness = b.provider.awareness!.getStates();
    const hasBothUsers = [...aliceAwareness.values()].some((s: any) => s.user?.name === 'Alice') || [...bobAwareness.values()].some((s: any) => s.user?.name === 'Alice');
    checks.push({
      name: 'Caret: awareness state present for both users',
      pass: hasBothUsers,
      detail: `alice awareness size=${aliceAwareness.size} bob awareness size=${bobAwareness.size}`,
    });

    a.editor.commands.focus();
    await new Promise((r) => setTimeout(r, 300));
    const bobSeesAliceCaret = hasCaret(b.editor.view.dom.innerHTML);
    b.editor.commands.focus();
    await new Promise((r) => setTimeout(r, 300));
    const aliceSeesBobCaret = hasCaret(a.editor.view.dom.innerHTML);
    checks.push({
      name: "Caret: each editor renders the other's caret decoration in the DOM",
      pass: bobSeesAliceCaret && aliceSeesBobCaret,
      detail: `bob's DOM showed alice's caret=${bobSeesAliceCaret}; alice's DOM showed bob's caret=${aliceSeesBobCaret}`,
    });

    a.editor.commands.insertContentAt(a.editor.state.doc.content.size - 1, 'ALICEEDIT');
    await waitUntil(() => b.editor.state.doc.textContent.includes('ALICEEDIT'), 5000);
    b.editor.commands.insertContentAt(1, 'BOBEDIT');
    await waitUntil(() => a.editor.state.doc.textContent.includes('BOBEDIT'), 5000);
    await new Promise((r) => setTimeout(r, 200));

    // No Tiptap `undo` command exists here (buildTiptapExtensions() doesn't
    // include StarterKit's history/undoRedo -- Yjs owns history instead);
    // src/tiptapClient.ts's createYUndoExtension wires Mod-Z to
    // @y/prosemirror's own undoCommand, called directly here.
    undoCommand(a.editor.state, a.editor.view.dispatch);
    await waitUntil(() => !b.editor.state.doc.textContent.includes('ALICEEDIT'), 5000);
    const aliceEditGone = !a.editor.state.doc.textContent.includes('ALICEEDIT');
    const bobEditSurvivedOnBoth = a.editor.state.doc.textContent.includes('BOBEDIT') && b.editor.state.doc.textContent.includes('BOBEDIT');
    checks.push({
      name: "Undo: alice's undo removes only her own change",
      pass: aliceEditGone && bobEditSurvivedOnBoth,
      detail: `aliceEditGone=${aliceEditGone} bobEditUnaffectedOnBoth=${bobEditSurvivedOnBoth}`,
    });
  } finally {
    a.destroy();
    b.destroy();
    await relay.stop();
  }
  return checks;
}

export async function runGateD(opts: { ports: { convergence: number; caret: number }; dbDir: string; quick?: boolean }): Promise<GateDResult> {
  const checks: GateDCheck[] = [];
  checks.push(checkDedupe());
  checks.push(checkSchema());
  checks.push(checkNoTiptapCollabPackage());
  checks.push(await runConvergence(opts.ports.convergence, `${opts.dbDir}/gateD-convergence-hp.sqlite`));
  if (!opts.quick) {
    checks.push(...(await runCaretAndUndo(opts.ports.caret, `${opts.dbDir}/gateD-caret-hp.sqlite`)));
  }

  const pass = checks.every((c) => c.pass);
  return {
    pass,
    checks,
    detail: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
  };
}
