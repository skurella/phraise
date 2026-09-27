// Gate A (charter): "Two live editors and a relay exchange edits."
// Brief 01 task 5: two editors connected to one relay type into different
// paragraphs and each sees the other's text; report round-trip latency
// (median of 20 single-character edits).
import 'global-jsdom/register';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient } from '../src/client.js';
import { findPos, insertText, waitUntil } from './lib/edits.js';

export interface GateAResult {
  pass: boolean;
  medianLatencyMs: number;
  latencies: number[];
  detail: string;
}

const DOC_NAME = 'file:live.md';

function endOfParagraphContaining(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (node) => node.type.name === 'paragraph' && node.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate A: paragraph containing ${JSON.stringify(needle)} not found`);
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1;
}

export async function runGateA(opts: { port: number; seedsDir: string; dbPath: string }): Promise<GateAResult> {
  let relay: RelayHandle | undefined;
  try {
    relay = await startRelay({ port: opts.port, db: opts.dbPath, seeds: opts.seedsDir });
    const [a, b] = await Promise.all([
      createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' }),
      createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' }),
    ]);
    try {
      // Each editor types into a *different* paragraph.
      const posInA = endOfParagraphContaining(a.view, 'A closing paragraph');
      insertText(a.view, posInA, ' AAA');
      await waitUntil(() => b.view.state.doc.textContent.includes('AAA'), 5000);

      const posInB = endOfParagraphContaining(b.view, 'Some inline HTML');
      insertText(b.view, posInB, ' BBB');
      await waitUntil(() => a.view.state.doc.textContent.includes('BBB'), 5000);

      const bothSawTheOther =
        a.view.state.doc.textContent.includes('BBB') && b.view.state.doc.textContent.includes('AAA');

      // Round-trip latency: median of 20 single-character edits, editor A
      // -> observed by editor B, each measured independently by watching
      // editor B's total text length grow by exactly one character.
      const latencies: number[] = [];
      let typingPos = endOfParagraphContaining(a.view, 'AAA');
      for (let i = 0; i < 20; i++) {
        const beforeLen = b.view.state.doc.textContent.length;
        const start = performance.now();
        typingPos = insertText(a.view, typingPos, 'x');
        await waitUntil(() => b.view.state.doc.textContent.length === beforeLen + 1, 5000);
        latencies.push(performance.now() - start);
      }
      const sorted = [...latencies].sort((x, y) => x - y);
      const medianLatencyMs = sorted[Math.floor(sorted.length / 2)];

      return {
        pass: bothSawTheOther,
        medianLatencyMs,
        latencies,
        detail: bothSawTheOther
          ? `both editors saw each other's edit; median round-trip latency over 20 single-character edits: ${medianLatencyMs.toFixed(1)}ms`
          : 'editors did not converge on each other\'s edits',
      };
    } finally {
      a.destroy();
      b.destroy();
    }
  } finally {
    if (relay) await relay.stop();
  }
}
