// Plan section 3 point 4: render(doc) reads the CrdtDoc into a PMNode and
// hands it to src/markdown's renderDoc, which does the actual best-effort
// serialization (it needs nothing Yjs-typed; see markdown/render.ts's own
// origin comment for the spike-3 DocSync.renderDetailed this is adapted
// from).
import * as Y from 'yjs';
import { read } from './codec.js';
import { renderDoc, type RenderResult } from '../markdown/index.js';

export type { RenderResult };

export function render(doc: Y.Doc): RenderResult {
  return renderDoc(read(doc));
}
