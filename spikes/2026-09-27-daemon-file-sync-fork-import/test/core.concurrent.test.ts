import { test, expect } from 'vitest';
import * as Y from 'yjs';
import { DocSync } from '../src/core/docsync.js';
import { RemoteEditor } from '../src/testkit/remote-editor.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';
import { syncDocs } from './helpers.js';

interface Scenario {
  base: string;
  remoteEdit: (r: RemoteEditor, token: string) => void;
  editorText: (base: string, token: string) => string;
}

function differentBlocksScenario(): Scenario {
  return {
    base: 'One two three.\n\nFour five six.\n',
    remoteEdit: (r, token) => r.replaceWord(1, 0, token), // "Four" -> token, in paragraph 1
    editorText: (base, token) => base.replace('two', token), // paragraph 0
  };
}

function sameBlockScenario(): Scenario {
  return {
    base: 'Alpha bravo charlie delta.\n',
    remoteEdit: (r, token) => r.replaceWord(0, 3, token), // "delta" -> token
    editorText: (base, token) => base.replace('bravo', token), // "bravo" -> token, same paragraph
  };
}

for (const [name, makeScenario] of [
  ['different blocks', differentBlocksScenario],
  ['the same block', sameBlockScenario],
] as const) {
  for (const order of ['remote-then-save', 'save-then-remote'] as const) {
    test(`concurrent edits in ${name}, delivery order ${order}: converges, every inserted token present`, () => {
      const scenario = makeScenario();
      const ydoc = new Y.Doc({ gc: false });
      const sync = new DocSync(ydoc);
      const v0 = sync.adopt(scenario.base);

      const remoteDoc = new Y.Doc({ gc: false });
      syncDocs(ydoc, remoteDoc);

      const remoteToken = makeToken('remote');
      const localToken = makeToken('local');
      const editorText = scenario.editorText(v0.text, localToken);

      const remoteEditor = new RemoteEditor(remoteDoc);

      if (order === 'remote-then-save') {
        scenario.remoteEdit(remoteEditor, remoteToken);
        syncDocs(ydoc, remoteDoc); // daemon sees the remote edit first
        const result = sync.importText(editorText, { author: { name: 'local-editor', kind: 'local' }, base: v0 });
        expect(result.kind).toBe('ok');
      } else {
        const result = sync.importText(editorText, { author: { name: 'local-editor', kind: 'local' }, base: v0 });
        expect(result.kind).toBe('ok');
        scenario.remoteEdit(remoteEditor, remoteToken); // remote edits after, concurrently with the local edit
      }

      syncDocs(ydoc, remoteDoc);
      syncDocs(ydoc, remoteDoc); // settle any straggling ops both ways

      expect(Y.equalSnapshots(Y.snapshot(ydoc), Y.snapshot(remoteDoc))).toBe(true);

      const rendered = sync.render();
      const tokens = tokensIn(rendered);
      expect(tokens).toContain(remoteToken);
      expect(tokens).toContain(localToken);
    });
  }
}
