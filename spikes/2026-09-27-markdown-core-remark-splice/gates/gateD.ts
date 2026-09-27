// Gate D: editor-model fidelity. Threshold: 100%. This gate is mostly a
// report over facts already established by construction (a real
// prosemirror-model Schema, edits made via PM Transactions) plus a rollup
// of doc.check() and the A2/A3 results computed in gate A.
import { Schema } from 'prosemirror-model';
import { schema } from '../src/index.js';
import type { GateAFileResult } from './gateA.js';
import type { FileWordResult } from './gateB.js';

export interface GateDResult {
  schemaIsProseMirrorModel: boolean;
  docCheckTotal: number;
  docCheckOk: number;
  editedDocCheckTotal: number;
  editedDocCheckOk: number; // edits whose category isn't 'exception' implies newDoc.check() passed
  a2PassTotal: number;
  a2PassOk: number;
  a3PassTotal: number;
  a3PassOk: number;
  a3CodecOk: number;
  a3DocAttrLossCount: number;
  a3LeafMarkLossCount: number;
}

export function runGateD(gateA: GateAFileResult[], gateB: FileWordResult[]): GateDResult {
  const docCheckTotal = gateA.length;
  const docCheckOk = gateA.filter((r) => r.docCheckOk).length;
  const a2PassOk = gateA.filter((r) => r.a2ok).length;
  const a3PassOk = gateA.filter((r) => r.a3ok).length;
  const a3CodecOk = gateA.filter((r) => r.a3codecOk).length;
  const a3DocAttrLossCount = gateA.filter((r) => r.a3docAttrLoss).length;
  const a3LeafMarkLossCount = gateA.filter((r) => r.a3leafMarkLoss).length;

  let editedDocCheckTotal = 0;
  let editedDocCheckOk = 0;
  for (const fw of gateB) {
    for (const e of fw.edits) {
      editedDocCheckTotal++;
      if (e.category !== 'exception') editedDocCheckOk++;
    }
  }

  return {
    schemaIsProseMirrorModel: schema instanceof Schema,
    docCheckTotal,
    docCheckOk,
    editedDocCheckTotal,
    editedDocCheckOk,
    a2PassTotal: gateA.length,
    a2PassOk,
    a3PassTotal: gateA.length,
    a3PassOk,
    a3CodecOk,
    a3DocAttrLossCount,
    a3LeafMarkLossCount,
  };
}
