// Gate I (brief 03 task 3): the edit primitives a fuzz trial's two actors
// use. The local "editor" acts on a plain string buffer (no parsing --
// insertions/deletions target `\S+` word runs and blank-line gaps directly;
// this deliberately does not distinguish paragraphs from list items, table
// rows or code fences the way `parseMarkdown` would, trading precision for
// simplicity and speed across many trials -- occasionally landing inside a
// table or code fence is itself useful fuzzing, not a bug in the harness).
// The remote actor drives the real `RemoteEditor` (ProseMirror positions),
// so its inserts/deletes must stay schema-valid; see the comments below on
// why paragraph edits are done via `replaceWord` rather than `insertTextAt`.
import type { Node as PMNode } from 'prosemirror-model';
import type { RemoteClient } from '../../src/testkit/remote-client.js';
import { randInt, pick } from './prng.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// Orchestrator change: new paragraphs used to be one template ("Sentence with
// token X inside it."), so every inserted paragraph was within a few
// characters of every other one. That is an adversarial worst case for any
// text-similarity heuristic (block pairing, base choice) and unlike real
// writing. Sentences are now random words; FUZZ_TEMPLATED=1 restores the
// template as a stress variant.
const VOCAB = (
  'the a daemon file editor remote change save merge branch commit block list table code ' +
  'paragraph heading review draft comment token user peer relay document version history ' +
  'quickly slowly carefully always never often before after during while because although ' +
  'write read watch import export render parse serialize fork rebase detach restart persist ' +
  'green blue small large simple complex stale fresh local shared hidden visible careful exact'
).split(' ');

export function sentenceWith(token: string, rng: () => number): string {
  if (process.env.FUZZ_TEMPLATED) return `Sentence with token ${token} inside it.`;
  const n = 5 + randInt(rng, 8);
  const words = Array.from({ length: n }, () => pick(rng, VOCAB));
  words.splice(randInt(rng, n + 1), 0, token);
  const s = words.join(' ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

// ---------------------------------------------------------------- local (buffer)

/** Insert `token` at a random `\S+` word boundary (just before or just after that word). No-op (returns unchanged) if the buffer has no words. */
export function localInsertToken(text: string, token: string, rng: () => number): string {
  const words = [...text.matchAll(/\S+/g)];
  if (words.length === 0) return text;
  const w = pick(rng, words);
  const before = rng() < 0.5;
  const pos = before ? (w.index as number) : (w.index as number) + w[0].length;
  const needsLead = pos > 0 && !/\s/.test(text[pos - 1]);
  const needsTrail = pos < text.length && !/\s/.test(text[pos]);
  return text.slice(0, pos) + (needsLead ? ' ' : '') + token + (needsTrail ? ' ' : '') + text.slice(pos);
}

/** Deletes `token` (plus one adjacent space, so no double space results) if present. Returns `{text, deleted}`. */
export function localDeleteTokenIfPresent(text: string, token: string): { text: string; deleted: boolean } {
  if (!text.includes(token)) return { text, deleted: false };
  const re = new RegExp(` ?${escapeRegExp(token)} ?`);
  return { text: text.replace(re, (m) => (m.length > token.length ? ' ' : '')), deleted: true };
}

/** Inserts a new paragraph containing `token` at a random blank-line gap (or the very start/end). */
export function localInsertParagraph(text: string, token: string, rng: () => number): string {
  const gaps: number[] = [0];
  const re = /\n{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) gaps.push(m.index + m[0].length);
  gaps.push(text.length);
  const gap = pick(rng, gaps);
  const paragraph = sentenceWith(token, rng);
  if (gap === text.length) return `${text}${text.endsWith('\n') ? '' : '\n'}\n${paragraph}\n`;
  if (gap === 0) return `${paragraph}\n\n${text}`;
  return `${text.slice(0, gap)}${paragraph}\n\n${text.slice(gap)}`;
}

// ------------------------------------------------------------- remote (ProseMirror)

/** Every `paragraph`-type node in document order, any depth -- matches `RemoteEditor.replaceWord`'s own indexing exactly. */
export function paragraphsInDocOrder(doc: PMNode): PMNode[] {
  const list: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') list.push(node);
    return true;
  });
  return list;
}

/**
 * Inserts `token` into a random existing paragraph, via `replaceWord`
 * (append the token after a random existing word rather than truly
 * inserting): reusing `replaceWord`'s search-an-existing-word-then-replace
 * machinery keeps this schema-valid no matter how deep the paragraph is
 * nested (list item, blockquote, table cell, top level), instead of having
 * to reason case-by-case about which top-level node types accept a raw
 * inline-content splice (a `table` node, for instance, does not).
 */
export function remoteInsertToken(client: RemoteClient, token: string, rng: () => number): boolean {
  const paras = paragraphsInDocOrder(client.editor.currentDoc());
  if (paras.length === 0) return false;
  const idx = randInt(rng, paras.length);
  const words = [...paras[idx].textContent.matchAll(/\S+/g)];
  if (words.length === 0) return false;
  const wIdx = randInt(rng, words.length);
  client.editor.replaceWord(idx, wIdx, `${words[wIdx][0]} ${token}`);
  return true;
}

/** Deletes `token` if it is present as a whole word in some paragraph of the remote doc. */
export function remoteDeleteTokenIfPresent(client: RemoteClient, token: string): boolean {
  const paras = paragraphsInDocOrder(client.editor.currentDoc());
  for (let i = 0; i < paras.length; i++) {
    const words = [...paras[i].textContent.matchAll(/\S+/g)];
    const wIdx = words.findIndex((m) => m[0] === token);
    if (wIdx >= 0) {
      client.editor.replaceWord(i, wIdx, '');
      return true;
    }
  }
  return false;
}

/** Inserts a new paragraph containing `token` after a random top-level block (any type: `doc`'s content is `block+`, so any block-group sibling is valid anywhere). */
export function remoteInsertParagraph(client: RemoteClient, token: string, rng: () => number): void {
  const doc = client.editor.currentDoc();
  const blockIndex = randInt(rng, doc.childCount);
  client.editor.insertParagraphAfter(blockIndex, sentenceWith(token, rng));
}

/** Deletes a random whole top-level block (never the last remaining one: `doc` requires `block+`). Returns the deleted block's text content (for token bookkeeping), or `undefined` if skipped. */
export function remoteDeleteWholeBlock(client: RemoteClient, rng: () => number): string | undefined {
  const doc = client.editor.currentDoc();
  if (doc.childCount <= 1) return undefined;
  const blockIndex = randInt(rng, doc.childCount);
  let deletedText = '';
  doc.forEach((node, _offset, i) => {
    if (i === blockIndex) deletedText = node.textContent;
  });
  client.editor.deleteBlock(blockIndex);
  return deletedText;
}
