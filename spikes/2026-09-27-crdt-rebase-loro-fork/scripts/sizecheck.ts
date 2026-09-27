// Reproduces the README's "sizes" numbers for this fork. Run with
// `npx tsx scripts/sizecheck.ts`. The equivalent Yjs-side numbers were
// produced by an identical script run from a throwaway copy of the Yjs
// fork's src/ (never committed there, per the brief's "do not modify" rule
// for that spike).
import fs from "node:fs";
import { seedDoc } from "../src/seed.js";
import { computeRebaseUpdate } from "../src/rebase.js";

const md = fs.readFileSync("fixtures/corpus/2026-09-27-agent-workflow.md", "utf8");
console.log("source markdown bytes:", Buffer.byteLength(md));
const doc = seedDoc("sizecheck", md, "A", { name: "Repo Owner", email: "o@example.com" });
console.log("Loro snapshot bytes (seed only):", doc.export({ mode: "snapshot" }).length);

const mdB = md.replace("agent", "AGENT");
const { update } = computeRebaseUpdate(doc, {
  docId: "sizecheck",
  targetMarkdown: mdB,
  targetCommit: "B",
  author: { name: "C2", email: "c2@example.com" },
  granularity: "word",
});
console.log("Loro rebase update bytes (one word changed):", update.length);
doc.import(update);
doc.commit();
console.log("Loro snapshot bytes (after rebase):", doc.export({ mode: "snapshot" }).length);
