// Brief 04, task 5/6: the status indicator's state machine, all four input
// combinations plus the exact label strings the brief specifies. Brief 05,
// task 4: a fifth input, `hasPendingWrites`, adds the "saving" state.
import { describe, expect, it } from 'vitest';
import { deriveSyncStatus, STATUS_LABEL } from '../src/offline/status.js';

describe('deriveSyncStatus', () => {
  it('is "offline" when the browser itself is offline and no write is pending, regardless of provider status', () => {
    expect(deriveSyncStatus(false, 'connected', false)).toBe('offline');
    expect(deriveSyncStatus(false, 'connecting', false)).toBe('offline');
    expect(deriveSyncStatus(false, 'disconnected', false)).toBe('offline');
  });

  it('is "saving" when the browser is offline AND a local edit\'s IndexedDB write is still in flight', () => {
    expect(deriveSyncStatus(false, 'connected', true)).toBe('saving');
    expect(deriveSyncStatus(false, 'disconnected', true)).toBe('saving');
  });

  it('is "saved" when online and the relay is connected, regardless of pending writes', () => {
    expect(deriveSyncStatus(true, 'connected', false)).toBe('saved');
    expect(deriveSyncStatus(true, 'connected', true)).toBe('saved');
  });

  it('is "reconnecting" when online but the relay is not (yet) connected, regardless of pending writes', () => {
    expect(deriveSyncStatus(true, 'connecting', false)).toBe('reconnecting');
    expect(deriveSyncStatus(true, 'disconnected', false)).toBe('reconnecting');
    expect(deriveSyncStatus(true, 'connecting', true)).toBe('reconnecting');
  });
});

describe('STATUS_LABEL', () => {
  it('matches the brief\'s exact wording', () => {
    expect(STATUS_LABEL.saved).toBe('Saved');
    expect(STATUS_LABEL.saving).toBe('Saving on this device');
    expect(STATUS_LABEL.offline).toBe('Offline, changes kept on this device');
    expect(STATUS_LABEL.reconnecting).toBe('Reconnecting');
  });
});
