# src/testkit

Test/gate infrastructure. May import anything in `src/`; nothing in `src/`
imports `testkit` back (enforced by convention, not yet a lint rule).

Brief 01 basics only:

- `ports.ts`: `allocatePort()` hands out a free TCP port on `127.0.0.1` in
  `[4300, 4399]` (charter's assigned range); `isPortFree()` for the gate
  runner's end-of-run check that nothing is still listening.
- `tmp.ts`: `makeTempDir()`, a fresh directory under `os.tmpdir()` with a
  returned `cleanup()`. (The git-specific version, a temp bare/working
  repository, is added by brief 02's `src/git/` module.)
- `prng.ts`: `mulberry32` seeded PRNG plus small helpers (`randInt`, `pick`,
  `randomWord`), for reproducible fuzzing -- every failing gate trial must
  replay from its seed alone.
- `tokens.ts`: `makeToken`/`tokensIn`, unique greppable markers a test
  inserts so it can assert "every edit survived a merge" without caring
  about wording or position.
- `waitFor.ts`: `waitFor(predicate, timeoutMs?, intervalMs?)`, poll until a
  condition holds or time out.
- `corpus.ts`: `handwrittenFiles()`, `fetchedFiles()`, `corpusFileById(id)`,
  `loadCorpus(quick?)`, `corpusFetched()` -- loads `corpus/handwritten/`
  (always present) and `corpus/fetched/{real,commonmark,gfm}/` (present
  after `npm run fetch`; tests skip what depends on it with a clear message
  when absent, per the brief's definition of done).

Later briefs add: temp bare git remotes and clones, a live jsdom editor
client, a relay harness (in-process and child-process).

## Origin of copied code

`prng.ts` -- spike 3 `gates/lib/prng.ts` (`9343b62`). `tokens.ts`,
`waitFor.ts` -- spike 3 `src/testkit/tokens.ts`/`wait-for.ts` (`9343b62`).
`corpus.ts` -- adapted from spike 1 `gates/lib/corpus.ts` (`1e1f4a6`).
`ports.ts`, `tmp.ts` are new (no equivalent file existed in the four source
spikes' testkits).
