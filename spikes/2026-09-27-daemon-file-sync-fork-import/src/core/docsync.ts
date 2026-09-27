// DocSync: the pure, synchronous core (plan section 3). Wraps a live Y.Doc
// (gc: false -- forks need tombstones, `Y.createDocFromSnapshot` refuses a
// garbage-collected doc) and turns a saved file's text into attributed CRDT
// operations without reverting anything a remote peer did after the
// editor's base (plan 3.3), and renders the CRDT back to bytes (plan 3.5).
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode, updateYFragment } from 'y-prosemirror';
import type { Node as PMNode } from 'prosemirror-model';
import {
  parseMarkdown,
  serializeDoc,
  docToYDoc,
  yDocToDoc,
  encodeLeafMarks,
  semanticEq,
  schema,
  UnverifiedSerializationError,
} from '../md/index.js';
import { FRAGMENT_NAME, META_MAP_NAME } from '../md/yjs.js';
import { applyDiff, type DiffCounters } from './diff.js';
import { VersionRing, chooseBase, diffCost, hashText, type Version } from './versions.js';

/** Yjs transaction origin used for every mutation this module makes. */
export const ORIGIN_IMPORT = 'phraise-import';

const AUTHORS_MAP_NAME = 'phraise-authors';

export type AuthorKind = 'local' | 'remote' | 'git';

export interface Author {
  name: string;
  kind: AuthorKind;
}

export interface AuthorRecord extends Author {
  at: number;
}

export interface ImportOptions {
  author: Author;
  /** Force a specific base version instead of `chooseBase`'s pick (e.g. a persisted base on restart). */
  base?: Version;
}

export interface ImportNoop {
  kind: 'noop';
  base: Version;
  cost: number;
}

export interface ImportOk {
  kind: 'ok';
  base: Version;
  cost: number;
  forked: boolean;
  repaired: boolean;
  counters: DiffCounters;
  version: Version;
}

export type ImportResult = ImportNoop | ImportOk;

export interface RenderOptions {
  /**
   * Whole-document check (debug/gate mode): `parseMarkdown(out)` must be
   * semantically equal to the doc, because block serialization is verified
   * per block in isolation and some constructs are not compositional (an
   * unclosed fence that is no longer last swallows what follows). Throws
   * `UnverifiedSerializationError` on mismatch, same as a per-block
   * verification failure; the `candidate` field carries the full `out`
   * text the caller can still use to count this as a violation rather than
   * abort. Fixing such violations is a finding, not a precondition here.
   */
  wholeDocCheck?: boolean;
}

/** Reads the live/forked doc's PM view WITHOUT decoding leaf marks, so it lines
 * up with `encodeLeafMarks(newDoc)` for an apples-to-apples structural diff
 * against Y's actual on-the-wire encoding (inline leaves carry their marks
 * in the meta `leafMarks` attr, not as real PM marks, until decoded). */
function currentEncoded(ydoc: Y.Doc): PMNode {
  const meta = ydoc.getMap(META_MAP_NAME);
  const root = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FRAGMENT_NAME), schema);
  return schema.node('doc', { lead: meta.get('lead') ?? '', eol: meta.get('eol') ?? '\n' }, root.content);
}

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
}

export class DocSync {
  readonly doc: Y.Doc;
  private readonly ring = new VersionRing();

  constructor(doc: Y.Doc = new Y.Doc({ gc: false })) {
    if (doc.gc) {
      throw new Error('DocSync requires a Y.Doc created with { gc: false } (forks need tombstones)');
    }
    this.doc = doc;
  }

  get versions(): readonly Version[] {
    return this.ring.all();
  }

  get authors(): Record<string, AuthorRecord> {
    const out: Record<string, AuthorRecord> = {};
    this.doc.getMap(AUTHORS_MAP_NAME).forEach((v, k) => {
      out[k] = v as AuthorRecord;
    });
    return out;
  }

  /** Seed an empty doc from text: the fresh-save special case's starting point. */
  adopt(text: string): Version {
    const parsed = parseMarkdown(text);
    docToYDoc(parsed.doc, this.doc);
    const snapshot = Y.snapshot(this.doc);
    return this.ring.push({ text, hash: hashText(text), snapshot, origin: 'adopt', at: Date.now() });
  }

  /** Record a `write` version: the file side certainly has this text, snapshot taken at render time. */
  recordWrite(text: string): Version {
    const snapshot = Y.snapshot(this.doc);
    return this.ring.push({ text, hash: hashText(text), snapshot, origin: 'write', at: Date.now() });
  }

  /** `render()` per plan 3.5: `serializeDoc(yDocToDoc(live))`. */
  render(opts: RenderOptions = {}): string {
    const doc = yDocToDoc(this.doc);
    const out = serializeDoc(doc);
    if (opts.wholeDocCheck) {
      const reparsed = parseMarkdown(out).doc;
      if (!semanticEq(doc, reparsed)) {
        throw new UnverifiedSerializationError(-1, 'doc', out);
      }
    }
    return out;
  }

  /** `importText` per plan 3.3. */
  importText(text: string, opts: ImportOptions): ImportResult {
    const candidates = this.ring.candidates();
    const base = opts.base ?? chooseBase(text, candidates).base;
    const cost = diffCost(base.text, text);
    if (cost === 0) {
      return { kind: 'noop', base, cost };
    }

    const parsed = parseMarkdown(text);
    const newDocEncoded = encodeLeafMarks(parsed.doc);

    const liveSnapshot = Y.snapshot(this.doc);
    const forked = !Y.equalSnapshots(liveSnapshot, base.snapshot);

    let target: Y.Doc;
    let clientId: number;
    let svBeforeDiff: Uint8Array | undefined;

    if (forked) {
      target = Y.createDocFromSnapshot(this.doc, base.snapshot, new Y.Doc({ gc: false }));
      clientId = Math.floor(Math.random() * 0xffffffff);
      target.clientID = clientId;
      svBeforeDiff = Y.encodeStateVector(target);
    } else {
      target = this.doc;
      clientId = this.doc.clientID;
    }

    let counters!: DiffCounters;
    target.transact(() => {
      // Only write map entries that change, so a save that touches one block
      // produces operations only inside that block (gate B).
      const authors = target.getMap(AUTHORS_MAP_NAME);
      const known = authors.get(String(clientId)) as AuthorRecord | undefined;
      if (!known || known.name !== opts.author.name || known.kind !== opts.author.kind) {
        authors.set(String(clientId), { name: opts.author.name, kind: opts.author.kind, at: Date.now() });
      }

      const meta = target.getMap(META_MAP_NAME);
      const lead = newDocEncoded.attrs.lead ?? '';
      const eol = newDocEncoded.attrs.eol ?? '\n';
      if (meta.get('lead') !== lead) meta.set('lead', lead);
      if (meta.get('eol') !== eol) meta.set('eol', eol);

      const fragment = target.getXmlFragment(FRAGMENT_NAME);
      const aChildren = nodeChildren(currentEncoded(target));
      const bChildren = nodeChildren(newDocEncoded);
      counters = applyDiff(fragment, aChildren, bChildren);
    }, ORIGIN_IMPORT);

    // Verify: JSON of yDocToDoc(target) equals JSON of newDoc, meta attrs
    // included (stricter than semanticEq, which ignores meta attrs -- this
    // check is specifically meant to catch attr-sync bugs the diff might
    // have introduced).
    const resultDoc = yDocToDoc(target);
    let repaired = false;
    if (JSON.stringify(resultDoc.toJSON()) !== JSON.stringify(parsed.doc.toJSON())) {
      repaired = true;
      target.transact(() => {
        const fragment = target.getXmlFragment(FRAGMENT_NAME);
        updateYFragment(target, fragment, newDocEncoded, { mapping: new Map(), isOMark: new Map() } as any);
      }, ORIGIN_IMPORT);
    }

    if (forked) {
      const update = Y.encodeStateAsUpdate(target, svBeforeDiff!);
      Y.applyUpdate(this.doc, update, ORIGIN_IMPORT);
    }

    const snapshot = Y.snapshot(target);
    const version = this.ring.push({ text, hash: hashText(text), snapshot, origin: 'import', at: Date.now() });

    return { kind: 'ok', base, cost, forked, repaired, counters, version };
  }
}
