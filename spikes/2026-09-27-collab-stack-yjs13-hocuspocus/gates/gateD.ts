// Gate D (charter): "Tiptap 3 with its collaboration and cursor extensions
// works on the stack, or state what has to be replaced by custom
// extensions."
//
// Brief 03, task 4. Reuses gate B's exact edit script and equality check
// against two real Tiptap `Editor`s instead of raw ProseMirror
// `EditorView`s -- `editor.view` (Tiptap's own escape hatch to the
// underlying prosemirror-view EditorView) is passed straight into
// gates/lib/edits.ts's helpers unchanged, since @tiptap/pm re-exports the
// exact same (deduped, confirmed below) prosemirror-view/-model/-state
// modules this whole package already uses.
import 'global-jsdom/register';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createTiptapLiveClient, type TiptapLiveClient } from '../src/tiptapClient.js';
import { waitUntil } from '../src/client.js';
import { schema } from '../src/schema.js';
import { buildTiptapSchema, checkSchemaEquivalence } from '../src/tiptapExtensions.js';
import { findPos, insertText, pasteHTMLAt, splitBlockAt, joinBackwardAt, addMarkAt, deleteRange } from './lib/edits.js';
import { checkEquality, decodeRelayState, linkedImages } from './lib/equality.js';
import { Mark } from 'prosemirror-model';

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
  // "Watch for two copies of prosemirror-model or prosemirror-state
  // (Tiptap requires a single instance; check npm ls prosemirror-model and
  // dedupe)." Parses `npm ls --json` for both packages and asserts exactly
  // one resolved version each, rather than trusting a one-time manual
  // check -- this way a future dependency bump that reintroduces a
  // duplicate fails the gate instead of silently shipping.
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
    const [pkg, ver] = v.split('@').length > 2 ? [v.slice(0, v.lastIndexOf('@')), v.slice(v.lastIndexOf('@') + 1)] : v.split('@');
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
    name: 'Schema: Tiptap-generated schema equivalent to src/schema.ts (17 nodes, 5 marks)',
    pass: eq.equal,
    detail: eq.equal ? `${tSchema.spec.nodes.size} nodes, ${tSchema.spec.marks.size} marks, all fields match` : eq.diffs.join('; '),
  };
}

async function runScript(a: TiptapLiveClient, b: TiptapLiveClient): Promise<void> {
  // Identical to gates/gateB.ts's runScript, operating on editor.view.
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

async function runConvergence(port: number, dbPath: string): Promise<GateDCheck> {
  fs.rmSync(dbPath, { force: true });
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
  const a = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice', user: { name: 'Alice', color: '#ff0000' } });
  const b = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob', user: { name: 'Bob', color: '#0000ff' } });
  try {
    await runScript(a, b);
    const relayBytes = await relay.fetchState(DOC_NAME);
    const relayDoc = decodeRelayState(relayBytes, { codec: true });
    // canonicalize() below, not raw editor.state.doc: see its doc comment.
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

/**
 * A live Tiptap editor's doc uses Tiptap's OWN Schema instance (a fresh
 * object graph `getSchema()` builds from src/tiptapExtensions.ts's
 * converted extensions every time an Editor is constructed -- confirmed by
 * reading @tiptap/core's ExtensionManager source: `this.schema =
 * getSchemaByResolvedExtensions(...)`, unconditionally, with no override
 * hook to reuse an externally-supplied Schema object). checkSchemaEquivalence
 * above proves it's structurally equivalent to src/schema.ts's canonical
 * `schema`, but it is never the SAME object, so its NodeTypes/MarkTypes are
 * never `===` to the canonical schema's.
 *
 * src/compare.ts's semanticEq was fixed (brief 03) to compare by node/mark
 * NAME rather than by type reference, for exactly this reason. That was
 * NOT enough on its own, though: src/serialize.ts's splice-candidate ladder
 * (tryTextSplice/tryLinkSplice/tryTextblockSplice) leans on ProseMirror's
 * OWN native `Fragment.findDiffStart`/`findDiffEnd` and `Node.eq()`, which
 * are reference-based internally and not ours to patch (they're
 * prosemirror-model library code, not this package's). Confirmed directly:
 * with only the semanticEq fix, `serializeDoc` still failed immediately on
 * an UNTOUCHED heading, from the very first (pre-edit) check -- pure
 * schema-instance mismatch, not a real content difference.
 *
 * The fix used here: convert a Tiptap-schema doc to the canonical schema
 * via a JSON round-trip (`schema.nodeFromJSON(doc.toJSON())`) before
 * handing it to serializeDoc/semanticEq/linkedImages. JSON is exactly the
 * schema-agnostic wire format Tiptap's own sync mechanism already uses, and
 * the equivalence check above is what makes this round-trip lossless
 * between the two schemas (same node/mark names and attrs) -- it is not a
 * workaround so much as the intended way to hand a Tiptap document to code
 * written against a specific canonical Schema instance.
 */
function canonicalize(doc: import('prosemirror-model').Node): import('prosemirror-model').Node {
  return schema.nodeFromJSON(doc.toJSON());
}

function hasCaret(html: string): boolean {
  return html.includes('collaboration-cursor__caret') || html.includes('ProseMirror-yjs-cursor');
}

async function runCaretAndUndo(port: number, dbPath: string): Promise<GateDCheck[]> {
  const checks: GateDCheck[] = [];
  fs.rmSync(dbPath, { force: true });
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
  const a = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice', user: { name: 'Alice', color: '#ff0000' } });
  const b = await createTiptapLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob', user: { name: 'Bob', color: '#0000ff' } });
  try {
    // Awareness state present, regardless of focus.
    await new Promise((r) => setTimeout(r, 200));
    const users = a.editor.storage.collaborationCaret?.users ?? [];
    const hasBothUsers = users.some((u) => u.name === 'Alice') && users.some((u) => u.name === 'Bob');
    checks.push({
      name: 'Caret: awareness state present for both users',
      pass: hasBothUsers,
      detail: `collaborationCaret.users=${JSON.stringify(users)}`,
    });

    // Caret DOM rendering, sequential (see the doc comment above -- both
    // editors share one jsdom window/document in this harness, which can
    // only focus one element at a time; a real deployment is one browser
    // tab per user, where this isn't a constraint).
    a.editor.commands.focus();
    await new Promise((r) => setTimeout(r, 300));
    const bobSeesAliceCaret = hasCaret(b.editor.view.dom.innerHTML);
    b.editor.commands.focus();
    await new Promise((r) => setTimeout(r, 300));
    const aliceSeesBobCaret = hasCaret(a.editor.view.dom.innerHTML);
    checks.push({
      name: 'Caret: each editor renders the other\'s caret decoration in the DOM',
      pass: bobSeesAliceCaret && aliceSeesBobCaret,
      detail: `bob's DOM showed alice's caret=${bobSeesAliceCaret}; alice's DOM showed bob's caret=${aliceSeesBobCaret}`,
    });

    // Undo isolation.
    a.editor.commands.insertContentAt(a.editor.state.doc.content.size - 1, 'ALICEEDIT');
    await waitUntil(() => b.editor.state.doc.textContent.includes('ALICEEDIT'), 5000);
    b.editor.commands.insertContentAt(1, 'BOBEDIT');
    await waitUntil(() => a.editor.state.doc.textContent.includes('BOBEDIT'), 5000);
    await new Promise((r) => setTimeout(r, 200));

    a.editor.commands.undo();
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
  checks.push(await runConvergence(opts.ports.convergence, `${opts.dbDir}/gateD-convergence.sqlite`));
  // gates:quick's "short version": skip the caret/undo relay round (its own
  // checks, not this gate's headline requirement) to keep the quick run fast.
  if (!opts.quick) {
    checks.push(...(await runCaretAndUndo(opts.ports.caret, `${opts.dbDir}/gateD-caret.sqlite`)));
  }

  const pass = checks.every((c) => c.pass);
  return {
    pass,
    checks,
    detail: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
  };
}
