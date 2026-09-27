// New for this spike (no equivalent file existed in the four source
// spikes' testkits under this name; spike 3's testkit/temp-repo.ts does the
// git-specific version of this, `makeTempRepo`). Charter: "Tests use
// temporary directories and temporary git repositories under $TMPDIR. Never
// use the Phraise repository or any of the owner's directories as test
// data."
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TempDir {
  readonly path: string;
  /** Removes the whole temp directory. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/** A fresh empty directory under `os.tmpdir()`, with a returned cleanup. */
export async function makeTempDir(prefix = 'phraise-'): Promise<TempDir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  let cleaned = false;
  return {
    path: dir,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
