import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { parseMarkdown } from "../src/markdown.js";
import { seedDoc, docToPM } from "../src/seed.js";
import { DOC_ID, AUTHOR } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "..", "fixtures", "corpus");

describe("parse -> seed -> docToPM round-trip over the corpus", () => {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    it(`round-trips ${file}`, () => {
      const md = readFileSync(join(CORPUS_DIR, file), "utf8");
      const parsed = parseMarkdown(md);
      const doc = seedDoc(DOC_ID, md, `commit-${file}`, AUTHOR);
      const roundTripped = docToPM(doc);
      expect(roundTripped.eq(parsed)).toBe(true);
    });
  }
});

describe("seedDoc determinism", () => {
  it("two seeds of the same commit are byte-identical", () => {
    const md = "# Hello\n\nSome *text* here.\n";
    const a = seedDoc(DOC_ID, md, "c1", AUTHOR);
    const b = seedDoc(DOC_ID, md, "c1", AUTHOR);
    expect(Buffer.from(Y.encodeStateAsUpdate(a))).toEqual(
      Buffer.from(Y.encodeStateAsUpdate(b))
    );
  });
});
