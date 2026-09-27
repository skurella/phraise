// Gate A: no-edit round trip. A2: doc.toJSON()/Node.fromJSON round trip.
// A3: Yjs (y-prosemirror) round trip. Threshold: 100% for corpus files
// (handwritten + real); spec sets (commonmark, gfm) reported alongside with
// their own numbers, no threshold.
import { Node as PMNode } from 'prosemirror-model';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { serializeDoc, schema, docToYDoc, yDocToDoc, type TraceInfo } from '../src/index.js';
import type { ParsedFile } from './lib/parsedFile.js';

export interface GateAFileResult {
  id: string;
  ok: boolean; // gate A: byte-identical
  docCheckOk: boolean; // doc.check() passed (gate D: editor-model fidelity)
  a2ok: boolean;
  a3ok: boolean;
  a3codecOk: boolean; // A3b: through src/yjs.ts codec and an encoded update into a second Y.Doc
  a3docAttrLoss: boolean; // a3 mismatch traceable to y-prosemirror dropping the *doc* node's own attrs (lead/eol)
  a3leafMarkLoss: boolean; // a3 mismatch traceable to y-prosemirror dropping marks on non-text leaf inline nodes (image, hard_break)
  unstableBlocks: number;
  pathCounts: Partial<Record<TraceInfo['kind'], number>>;
  error?: string;
}

function bumpPath(counts: Partial<Record<TraceInfo['kind'], number>>, kind: TraceInfo['kind']) {
  counts[kind] = (counts[kind] ?? 0) + 1;
}

/** Count non-text inline leaf nodes (image, hard_break) that carry at least one mark. */
function countMarkedLeaves(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (!node.isText && node.isInline && node.marks.length > 0) n++;
  });
  return n;
}

export function runGateAOne(pf: ParsedFile): GateAFileResult {
  const { file, doc } = pf;
  if (pf.error) {
    return {
      id: file.id,
      ok: false,
      docCheckOk: false,
      a2ok: false,
      a3ok: false,
      a3codecOk: false,
      a3docAttrLoss: false,
      a3leafMarkLoss: false,
      unstableBlocks: 0,
      pathCounts: {},
      error: pf.error,
    };
  }
  const pathCounts: Partial<Record<TraceInfo['kind'], number>> = {};
  let unstableBlocks = 0;
  doc.forEach((b) => {
    if (b.type.name === 'raw_block' && String(b.attrs.kind).startsWith('unstable:')) unstableBlocks++;
  });

  let docCheckOk = false;
  try {
    doc.check();
    docCheckOk = true;
  } catch {
    docCheckOk = false;
  }

  let ok = false;
  let error: string | undefined;
  try {
    const out = serializeDoc(doc, { trace: (info) => bumpPath(pathCounts, info.kind) });
    ok = out === file.md;
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  // A2: doc.toJSON() -> Node.fromJSON round trip.
  let a2ok = false;
  try {
    const json = doc.toJSON();
    const doc2 = PMNode.fromJSON(schema, json);
    a2ok = serializeDoc(doc2) === file.md;
  } catch {
    a2ok = false;
  }

  // A3: Yjs round trip via y-prosemirror's XmlFragment binding (the same
  // path the live editor would use with ySyncPlugin).
  let a3ok = false;
  let a3docAttrLoss = false;
  let a3leafMarkLoss = false;
  try {
    const ydoc = new Y.Doc();
    const xml = ydoc.getXmlFragment('prosemirror');
    prosemirrorToYXmlFragment(doc, xml);
    const doc2 = yXmlFragmentToProseMirrorRootNode(xml, schema);
    const out2 = serializeDoc(doc2);
    a3ok = out2 === file.md;
    if (!a3ok) {
      // Two distinct, confirmed y-prosemirror limitations (not bugs in this
      // spike's code): (1) the XmlFragment has no slot for the *root* doc
      // node's own attrs, so `lead`/`eol` always come back at their schema
      // defaults; (2) marks on a non-text inline leaf node (e.g. `image`,
      // `hard_break` -- most commonly an image wrapped in a link, `[![alt](img)](href)`)
      // are silently dropped on the way through the XmlFragment. Detect each
      // cause explicitly so the finding is precise rather than a blanket
      // failure count.
      const lostLead = (doc.attrs.lead ?? '') !== '' && (doc2.attrs.lead ?? '') === '';
      const lostEol = doc.attrs.eol !== doc2.attrs.eol;
      a3docAttrLoss = lostLead || lostEol;
      a3leafMarkLoss = countMarkedLeaves(doc2) < countMarkedLeaves(doc);
    }
  } catch {
    a3ok = false;
  }

  // A3b: the Phraise codec (root attrs in a Y.Map, inline-leaf marks encoded
  // in a meta attr), shipped as a binary update to a second Y.Doc, the way a
  // relay or a second client would receive it.
  let a3codecOk = false;
  try {
    const y1 = docToYDoc(doc);
    const y2 = new Y.Doc();
    Y.applyUpdate(y2, Y.encodeStateAsUpdate(y1));
    a3codecOk = serializeDoc(yDocToDoc(y2)) === file.md;
  } catch {
    a3codecOk = false;
  }

  return { id: file.id, ok, docCheckOk, a2ok, a3ok, a3codecOk, a3docAttrLoss, a3leafMarkLoss, unstableBlocks, pathCounts, error };
}

export function runGateA(files: ParsedFile[]): GateAFileResult[] {
  return files.map(runGateAOne);
}
