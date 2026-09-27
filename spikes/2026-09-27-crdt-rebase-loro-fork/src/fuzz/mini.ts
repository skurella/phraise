// Mini fuzz harness (brief 4 item 6: "a mini fuzz of at least 200 trials").
// A deliberately much smaller version of the Yjs fork's brief-3 fuzz harness
// (src/fuzz/*.ts there is ~9 files covering corpus windowing, structural
// mutation generators, per-category loss classification, a granularity
// comparison CLI, and repro scripts) -- this is a scope cut for time, logged
// here and in the README. It covers the same four gated categories the
// brief names (exception, diverged, local-text-lost, F-violation) on a
// single ("word") granularity, with simpler mutation generators (word-level
// text edits and whole-block insert/delete only, no marks/heading-level/
// list mutations), and no separate granularity-comparison mode.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Replica, deliver } from "../replica.js";
import { needsReview, collectBlocks } from "../integrate.js";
import { parseMarkdown, serializeMarkdown } from "../markdown.js";
import { docPlainText } from "../text.js";
import { Fragment, type Node as PMNode } from "prosemirror-model";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(__dirname, "..", "..", "fixtures", "corpus");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trialRng(seed: number, trialIndex: number): () => number {
  return mulberry32(seed * 1000003 + trialIndex);
}

let corpusCache: string[] | null = null;
function corpusFiles(): string[] {
  if (corpusCache) return corpusCache;
  corpusCache = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => fs.readFileSync(path.join(CORPUS_DIR, f), "utf8"));
  return corpusCache;
}

function topBlocks(doc: PMNode): PMNode[] {
  const out: PMNode[] = [];
  doc.forEach((c) => out.push(c));
  return out;
}

/** A random contiguous window of 5-12 top-level blocks from a random corpus file, reserialized to canonical markdown. */
function pickWindow(rng: () => number): string {
  const files = corpusFiles();
  const file = files[Math.floor(rng() * files.length)];
  const doc = parseMarkdown(file);
  const blocks = topBlocks(doc);
  const want = Math.min(blocks.length, 5 + Math.floor(rng() * 8));
  const maxStart = Math.max(0, blocks.length - want);
  const start = Math.floor(rng() * (maxStart + 1));
  const slice = blocks.slice(start, start + want);
  const sub = doc.type.schema.node("doc", null, slice);
  return serializeMarkdown(sub);
}

const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);

function textblocks(doc: PMNode): PMNode[] {
  const out: PMNode[] = [];
  doc.descendants((n) => {
    if (TEXTBLOCK_NAMES.has(n.type.name)) {
      out.push(n);
      return false;
    }
    return true;
  });
  return out;
}

/** Build commit B's markdown by mutating a random textblock (word replace) or deleting a random top-level block. */
function mutateUpstream(mdA: string, rng: () => number): string {
  const doc = parseMarkdown(mdA);
  const mode = rng();
  if (mode < 0.5) {
    const blocks = textblocks(doc);
    if (blocks.length === 0) return mdA;
    const block = blocks[Math.floor(rng() * blocks.length)];
    const words = block.textContent.split(/\s+/).filter(Boolean);
    if (words.length === 0) return mdA;
    const wi = Math.floor(rng() * words.length);
    words[wi] = words[wi] + "X";
    const newText = words.join(" ");
    const newBlock = block.type.create(
      block.attrs,
      newText.length > 0 ? block.type.schema.text(newText) : null
    );
    return serializeMarkdown(replaceTextblock(doc, block, newBlock));
  } else {
    const top = topBlocks(doc);
    if (top.length <= 1) return mdA;
    const idx = Math.floor(rng() * top.length);
    const rest = top.filter((_, i) => i !== idx);
    return serializeMarkdown(doc.type.schema.node("doc", null, rest));
  }
}

/** Rebuild `doc`, replacing the node reference-equal to `target` with `replacement`. */
function replaceTextblock(doc: PMNode, target: PMNode, replacement: PMNode): PMNode {
  function rebuild(node: PMNode): PMNode {
    if (node === target) return replacement;
    if (node.childCount === 0) return node;
    const kids: PMNode[] = [];
    let changed = false;
    node.forEach((child) => {
      const r = rebuild(child);
      if (r !== child) changed = true;
      kids.push(r);
    });
    return changed ? node.copy(Fragment.fromArray(kids)) : node;
  }
  return rebuild(doc);
}

export type TrialCategory =
  | "ok"
  | "exception"
  | "diverged"
  | "local-text-lost"
  | "F-violation";

export interface MiniFuzzResult {
  total: number;
  counts: Record<string, number>;
  reproSamples: number[];
}

function runOneTrial(seed: number, trialIndex: number): TrialCategory {
  const rng = trialRng(seed, trialIndex);
  try {
    const mdA = pickWindow(rng);
    const docId = `fuzz-${seed}-${trialIndex}`;
    const server = new Replica("server", docId, mdA, "A", { name: "Repo Owner", email: "owner@example.com" });
    const alice = new Replica("alice", docId, mdA, "A", { name: "Repo Owner", email: "owner@example.com" }, {
      userId: "alice",
      name: "Alice",
    });
    server.link(alice);

    // Alice's local edit: insert a unique token at a random offset.
    const token = `TOK${seed}_${trialIndex}`;
    const { text } = docPlainText(alice.doc);
    let tokenOffset = -1;
    if (text.length > 0) {
      tokenOffset = Math.floor(rng() * text.length);
      alice.insertText(tokenOffset, ` ${token} `);
    }

    // Upstream mutation for commit B.
    const mdB = mutateUpstream(mdA, rng);

    server.runRebase(mdB, "B", { name: "Contributor Two", email: "c2@example.com" }, "word");
    // Drain both directions between server/alice until quiescent.
    for (let round = 0; round < 20; round++) {
      let progress = false;
      const sq = server._queueTo("alice");
      if (sq && sq.length > 0) {
        deliver(server, alice);
        progress = true;
      }
      const aq = alice._queueTo("server");
      if (aq && aq.length > 0) {
        deliver(alice, server);
        progress = true;
      }
      if (!progress) break;
    }

    const diverged = !server.docToPM().eq(alice.docToPM());
    if (diverged) return "diverged";

    if (tokenOffset >= 0) {
      const finalText = docPlainText(server.doc).text;
      if (!finalText.includes(token)) return "local-text-lost";
    }

    // F-violation: a block whose text is unchanged from commit A to commit
    // B (not the upstream mutation's target), and not flagged, must still
    // be byte-identical on the server -- checked by the block's own stable
    // container id (via forkAt at the stored A/B frontiers), the same
    // identity integrate.ts itself uses, not by re-deriving a text mapping
    // (which the first version of this check did, and which produced
    // overwhelmingly-false positives whenever alice's token happened to
    // land in an untouched block: comparing raw text sets can't tell "this
    // block changed because of the token" from "this block changed for a
    // real reason").
    const flagged = new Set(needsReview(server.doc).map((e) => e.blockId));
    const phraise = server.doc.getMap("phraise");
    const frontiersA = phraise.get("snapshot:A") as any;
    const frontiersB = phraise.get("snapshot:B") as any;
    if (frontiersA && frontiersB) {
      const forkA = server.doc.forkAt(frontiersA);
      const forkB = server.doc.forkAt(frontiersB);
      const blocksA = new Map(collectBlocks(forkA).map((b) => [b.id, b.text] as const));
      const blocksB = new Map(collectBlocks(forkB).map((b) => [b.id, b.text] as const));
      const blocksNow = new Map(collectBlocks(server.doc).map((b) => [b.id, b.text] as const));
      for (const [id, aText] of blocksA) {
        if (flagged.has(id)) continue;
        const bText = blocksB.get(id);
        if (bText === undefined || bText !== aText) continue; // this block WAS the upstream mutation's target (changed or deleted) -- not in scope for F
        const nowText = blocksNow.get(id);
        if (nowText === undefined || (!nowText.includes(token) && nowText !== aText)) {
          return "F-violation";
        }
      }
    }

    return "ok";
  } catch (e) {
    return "exception";
  }
}

export function runMiniFuzz(seed: number, count: number): MiniFuzzResult {
  const counts: Record<string, number> = { ok: 0, exception: 0, diverged: 0, "local-text-lost": 0, "F-violation": 0 };
  const reproSamples: number[] = [];
  for (let i = 0; i < count; i++) {
    const cat = runOneTrial(seed, i);
    counts[cat] = (counts[cat] ?? 0) + 1;
    if (cat !== "ok") reproSamples.push(i);
  }
  return { total: count, counts, reproSamples };
}
