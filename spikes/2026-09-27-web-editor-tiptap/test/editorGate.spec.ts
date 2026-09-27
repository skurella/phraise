// Brief 04, task 5/6: "build the editor after whichever comes first". Both
// orderings, and the "only the first call wins" rule.
import { describe, expect, it } from 'vitest';
import { createBuildGate } from '../src/offline/editorGate.js';

describe('createBuildGate', () => {
  it('resolves with "indexeddb" when that fires first', async () => {
    const gate = createBuildGate();
    gate.onIndexedDBSynced();
    gate.onProviderSynced();
    await expect(gate.ready).resolves.toBe('indexeddb');
  });

  it('resolves with "provider" when that fires first', async () => {
    const gate = createBuildGate();
    gate.onProviderSynced();
    gate.onIndexedDBSynced();
    await expect(gate.ready).resolves.toBe('provider');
  });

  it('resolves once even if the winning source is called again', async () => {
    const gate = createBuildGate();
    gate.onProviderSynced();
    gate.onProviderSynced();
    gate.onIndexedDBSynced();
    await expect(gate.ready).resolves.toBe('provider');
  });

  it('is not settled before either source fires, and settled after', async () => {
    const gate = createBuildGate();
    expect(gate.settled).toBe(false);
    gate.onIndexedDBSynced();
    expect(gate.settled).toBe(true);
    await gate.ready;
  });

  it('resolves asynchronously even when a source already fired before `ready` was read (a late .then still runs)', async () => {
    const gate = createBuildGate();
    gate.onIndexedDBSynced();
    let ran = false;
    await gate.ready.then(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
