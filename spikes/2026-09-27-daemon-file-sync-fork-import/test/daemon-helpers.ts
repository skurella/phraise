// Shared plumbing for test/daemon.*.test.ts: not itself a test file. Each
// fixture owns one relay and one temp git repository, per charter/plan 5
// ("each test makes its own git init repository under $TMPDIR and removes
// it"); call `setupFixture` in `beforeEach` and `fixture.cleanup()` in
// `afterEach` so cleanup runs on failure too.
import { startRelay, type RelayHandle } from '../src/relay/relay.js';
import { makeTempRepo, type TempRepo, type MakeTempRepoOptions } from '../src/testkit/temp-repo.js';
import { Daemon, type DaemonOptions } from '../src/daemon/daemon.js';
import { RemoteClient } from '../src/testkit/remote-client.js';

let counter = 0;

export interface Fixture {
  relay: RelayHandle;
  repo: TempRepo;
  docName: string;
  makeDaemon(overrides?: Partial<DaemonOptions>): Daemon;
  makeClient(): RemoteClient;
  cleanup(): Promise<void>;
}

export async function setupFixture(repoOpts: MakeTempRepoOptions = {}): Promise<Fixture> {
  const relay = await startRelay();
  const repo = await makeTempRepo(repoOpts);
  const docName = `doc-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  const daemons: Daemon[] = [];
  const clients: RemoteClient[] = [];

  const fixture: Fixture = {
    relay,
    repo,
    docName,
    makeDaemon(overrides = {}) {
      const daemon = new Daemon({
        repoDir: repo.repoDir,
        file: repo.file,
        docName,
        relayUrl: relay.url,
        user: { name: 'local-user' },
        ...overrides,
      });
      daemons.push(daemon);
      return daemon;
    },
    makeClient() {
      const client = new RemoteClient({ url: relay.url, docName });
      clients.push(client);
      return client;
    },
    async cleanup() {
      for (const c of clients.splice(0)) {
        try {
          c.destroy();
        } catch {
          // best effort
        }
      }
      for (const d of daemons.splice(0)) {
        try {
          await d.stop({ persist: false });
        } catch {
          // best effort
        }
      }
      await relay.stop();
      await repo.cleanup();
    },
  };
  return fixture;
}
