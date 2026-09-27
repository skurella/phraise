import { Node as PMNode } from 'prosemirror-model';
import { parseMarkdown, schema, type BlockPos } from '../../src/index.js';
import type { CorpusFile } from './corpus.js';

export interface ParsedFile {
  file: CorpusFile;
  doc: PMNode;
  positions: BlockPos[];
  /** Set if parseMarkdown itself threw; `doc` is then an empty placeholder. */
  error?: string;
}

const EMPTY_DOC = schema.node('doc', { lead: '', eol: '\n' }, [schema.node('paragraph', {}, [])]);

export function parseAll(files: CorpusFile[]): ParsedFile[] {
  return files.map((file) => {
    try {
      const { doc, positions } = parseMarkdown(file.md, { positions: true });
      return { file, doc, positions: positions ?? [] };
    } catch (e: any) {
      return { file, doc: EMPTY_DOC, positions: [], error: e?.message ?? String(e) };
    }
  });
}
