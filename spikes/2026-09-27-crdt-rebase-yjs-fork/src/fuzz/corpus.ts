// Corpus loading and window selection (brief 03, section 1, step 1): "a
// random window of 8 to 25 consecutive top-level blocks from a random file
// in fixtures/corpus/, serialized back to Markdown and re-parsed so A is
// canonical."
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { parseMarkdown, serializeMarkdown } from "../markdown.js";
import { schema } from "../schema.js";
import type { Rng } from "./prng.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "..", "..", "fixtures", "corpus");

export interface CorpusFile {
  name: string;
  text: string;
}

let cachedFiles: CorpusFile[] | null = null;

export function loadCorpusFiles(): CorpusFile[] {
  if (cachedFiles) return cachedFiles;
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  cachedFiles = files.map((f) => ({
    name: f,
    text: fs.readFileSync(path.join(CORPUS_DIR, f), "utf8"),
  }));
  return cachedFiles;
}

export interface DocumentA {
  markdown: string;
  pm: PMNode;
  sourceFile: string;
  windowStart: number;
  windowLen: number;
}

/**
 * Pick a random file and a random contiguous window of 8-25 top-level
 * blocks from it (clamped to the file's own block count when smaller),
 * serialize the window back to Markdown and re-parse it, so the returned
 * `pm`/`markdown` are canonical (re-parsing can normalize spacing etc., and
 * matters since later steps assert against `parseMarkdown` output too).
 */
export function pickWindow(rng: Rng): DocumentA {
  const files = loadCorpusFiles();
  const file = rng.pick(files);
  const fullDoc = parseMarkdown(file.text);
  const blocks: PMNode[] = [];
  fullDoc.forEach((child) => blocks.push(child));

  const maxLen = Math.min(25, blocks.length);
  const minLen = Math.min(8, blocks.length);
  const windowLen = rng.range(minLen, maxLen);
  const maxStart = Math.max(0, blocks.length - windowLen);
  const windowStart = rng.range(0, maxStart);

  const slice = blocks.slice(windowStart, windowStart + windowLen);
  const windowDoc = schema.nodes.doc.create(undefined, Fragment.fromArray(slice));
  const markdown = serializeMarkdown(windowDoc);
  const pm = parseMarkdown(markdown); // re-parse so A is canonical

  return { markdown, pm, sourceFile: file.name, windowStart, windowLen };
}
