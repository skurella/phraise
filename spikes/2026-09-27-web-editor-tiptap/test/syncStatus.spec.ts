// Brief 04, task 5/6: the status indicator's state machine, all four input
// combinations plus the exact label strings the brief specifies.
import { describe, expect, it } from 'vitest';
import { deriveSyncStatus, STATUS_LABEL } from '../src/offline/status.js';

describe('deriveSyncStatus', () => {
  it('is "offline" whenever the browser itself is offline, regardless of provider status', () => {
    expect(deriveSyncStatus(false, 'connected')).toBe('offline');
    expect(deriveSyncStatus(false, 'connecting')).toBe('offline');
    expect(deriveSyncStatus(false, 'disconnected')).toBe('offline');
  });

  it('is "saved" when online and the relay is connected', () => {
    expect(deriveSyncStatus(true, 'connected')).toBe('saved');
  });

  it('is "reconnecting" when online but the relay is not (yet) connected', () => {
    expect(deriveSyncStatus(true, 'connecting')).toBe('reconnecting');
    expect(deriveSyncStatus(true, 'disconnected')).toBe('reconnecting');
  });
});

describe('STATUS_LABEL', () => {
  it('matches the brief\'s exact wording', () => {
    expect(STATUS_LABEL.saved).toBe('Saved');
    expect(STATUS_LABEL.offline).toBe('Offline, changes kept on this device');
    expect(STATUS_LABEL.reconnecting).toBe('Reconnecting');
  });
});
