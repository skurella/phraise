// New for this spike (brief 04, src/relay/). The relay's HTTP control API
// (plan section 6): `GET /resolve`, `POST /flush`, `POST /commit`, `GET
// /state/<docName>`, `GET /markdown/<docName>`, `POST /poll`, `GET
// /health`. Wired through Hocuspocus's own `onRequest` hook (a plain
// `node:http` request/response pair per this version's own `.d.ts`);
// Hocuspocus's `requestHandler` always writes its own 200 "Welcome to
// Hocuspocus!" body after every `onRequest` hook resolves (unless the hook
// throws), so every route below neuters `response.writeHead`/`.end` right
// after using them for real (ported technique, spike 5's `src/relay.ts`
// `onRequest` hook has the same comment).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hocuspocus } from '@hocuspocus/server';
import { render, encodeState } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';
import { makeDocName } from './docName.js';
import type { RelayState } from './state.js';
import { flushBranch } from './flush.js';
import { commitDocument, type CommitRequest } from './commit.js';

// Milestone 1: no generations yet (charter/plan: "generation 0 for now").
const GENERATION = 0;

function sendJSON(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
  response.writeHead = (() => response) as unknown as ServerResponse['writeHead'];
  response.end = (() => response) as unknown as ServerResponse['end'];
}

function sendBinary(response: ServerResponse, status: number, body: Uint8Array): void {
  response.writeHead(status, { 'Content-Type': 'application/octet-stream' });
  response.end(Buffer.from(body));
  response.writeHead = (() => response) as unknown as ServerResponse['writeHead'];
  response.end = (() => response) as unknown as ServerResponse['end'];
}

async function readBody(request: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text;
}

export async function handleHttpRequest(
  instance: Hocuspocus,
  state: RelayState,
  gitStore: GitStore,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJSON(response, 200, { ok: true, documents: instance.getDocumentsCount(), counters: state.counters });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/resolve') {
    const branch = url.searchParams.get('branch');
    const filePath = url.searchParams.get('path');
    if (!branch || !filePath) {
      sendJSON(response, 400, { error: 'usage: GET /resolve?branch=<branch>&path=<path>' });
      return;
    }
    const docName = makeDocName(branch, filePath, GENERATION);
    const conn = await instance.openDirectConnection(docName, {});
    await conn.disconnect({ unloadImmediately: false });
    sendJSON(response, 200, { docName, generation: GENERATION });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/flush') {
    const body = JSON.parse((await readBody(request)) || '{}') as { branch?: string };
    if (!body.branch) {
      sendJSON(response, 400, { error: 'usage: POST /flush {branch}' });
      return;
    }
    const branchState = state.branchState(body.branch);
    const outcome = await state.queue.run(body.branch, () => flushBranch(gitStore, branchState, state.counters));
    sendJSON(response, outcome.ok ? 200 : 409, outcome);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/commit') {
    const body = JSON.parse((await readBody(request)) || '{}') as CommitRequest & { branch?: string };
    if (!body.branch || !body.path || !body.user) {
      sendJSON(response, 400, { error: 'usage: POST /commit {branch, path, user, message?}' });
      return;
    }
    const docName = makeDocName(body.branch, body.path, GENERATION);
    const conn = await instance.openDirectConnection(docName, { user: body.user });
    try {
      const branchState = state.branchState(body.branch);
      const openEntry = branchState.open.get(body.path);
      if (!openEntry) {
        sendJSON(response, 500, { error: `document "${docName}" did not register after load` });
        return;
      }
      const outcome = await state.queue.run(body.branch, () =>
        commitDocument(gitStore, branchState, openEntry.doc, { path: body.path, user: body.user, message: body.message }, state.counters),
      );
      sendJSON(response, outcome.ok ? 200 : 409, outcome);
    } finally {
      await conn.disconnect({ unloadImmediately: false });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/connections') {
    // Test/gate-only introspection (not in plan section 6's route list):
    // gate B needs to observe, from outside the relay, that a rejected
    // forger's connection was actually removed from the document -- a
    // client-side "close" event is not a reliable signal (the official
    // provider's CLOSE-message handler is a no-op by default, and its
    // reconnect logic would create a fresh, unblocked connection anyway).
    const documentName = url.searchParams.get('docName');
    const document = documentName ? instance.documents.get(documentName) : undefined;
    sendJSON(response, 200, { count: document ? document.getConnectionsCount() : 0 });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/state/')) {
    const documentName = decodeURIComponent(url.pathname.slice('/state/'.length));
    const document = instance.documents.get(documentName);
    sendBinary(response, 200, document ? encodeState(document) : new Uint8Array());
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/markdown/')) {
    const documentName = decodeURIComponent(url.pathname.slice('/markdown/'.length));
    const document = instance.documents.get(documentName);
    if (!document) {
      sendJSON(response, 404, { error: `document not loaded: ${documentName}` });
      return;
    }
    sendJSON(response, 200, render(document));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/poll') {
    // Head polling + rebase-on-poll is out of this brief's scope (plan
    // section 6's head poller; charter gate F, milestone 2, brief 06). The
    // route exists (plan section 6 names it) so callers can rely on it
    // being present, and returns an honestly empty result rather than 404.
    sendJSON(response, 200, { polled: [], note: 'head polling/rebase lands in a later brief (gate F)' });
    return;
  }

  // Anything else: let Hocuspocus's default "Welcome to Hocuspocus!" through.
}
