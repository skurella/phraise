// Brief 04's public surface: `startRelay` (in-process; `cli.ts` wraps it
// for a child process) plus the pieces a gate/test may need directly.
export { startRelay, type RelayOptions, type RelayTimings, type RelayHandle } from './server.js';
export { makeDocName, parseDocName, docId, type DocNameParts } from './docName.js';
export { RelayState, type RelayCounters, type BranchState, type OpenDoc } from './state.js';
export { identityFor } from './identity.js';
