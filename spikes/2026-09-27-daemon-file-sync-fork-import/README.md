# Spike 3: daemon file sync by fork-at-base import

Status: done. Gates A to H and J pass; F and I have a small, categorized residue. Numbers and the recommendation are in the [findings doc](../../context/docs/2026-09-27-spike-3-findings-daemon-file-sync.md).

## Goal

Decision D7: a local daemon materializes a live collaborative document as an ordinary file in a git working tree, watches it, and turns saves into attributed CRDT operations, safely under concurrency and hostile timing. See the [charter](../../context/plans/2026-09-27-spike-3-charter-daemon-file-sync.md) and the [plan](../../context/plans/2026-09-27-spike-3-plan.md), which is the design spec.

## The idea

A file save is an external edit with an unknown base. The daemon keeps a small ring of file versions the editor could have loaded, each with a Yjs snapshot. On a save it picks the most plausible base, forks the CRDT at that snapshot, applies a two-way block and word diff from the base to the saved bytes on the fork, and merges the fork back. Remote edits made after the base are concurrent with the fork and survive. This is spike 2's rebase mechanism applied to file saves; restart and fast-forward pulls are the same operation.

## How to run

```bash
npm ci
npm test              # unit and integration tests (vitest), about 20 s
npm run gates:quick   # every gate at small sample sizes, a few minutes
npm run gates         # every gate at full size, including the 300-trial fuzz; about 30 to 40 min
```

Both gate commands fetch the corpus first (`scripts/fetch-corpus.mjs`, pinned by SHA). Results go to `results/gates.md` and `results/gates.json`; gate F writes `results/f-roundtrip.json`, gate J `results/j-before.json` and `results/j-after.json`.

Other entry points:

- `npx tsx gates/fuzz.ts --trials N --seed S`: the gate I fuzz alone. A failing trial prints its seed; replay it with `--trials 1 --seed <seed>`. `FUZZ_DEBUG=1` traces steps and base choices, `PHRAISE_DEBUG=1` traces diffs and merges, `FUZZ_EDITOR=autoreload` models an editor that reloads clean buffers, `FUZZ_TEMPLATED=1` uses one sentence template for new paragraphs (a stress variant).
- `npx tsx gates/f-roundtrip.ts [--quick]`: gate F's core measurement alone.
- `npx tsx src/relay/cli.ts --port 4101` and `npx tsx src/daemon/cli.ts --relay ws://127.0.0.1:4101 --repo <dir> --file <path> --doc <name> --user <name>`: a relay and a daemon by hand; the daemon prints events as JSON lines.
- `tools/`: debugging aids (serialize one block, inspect a dumped Y document, check block counts).

Servers bind to 127.0.0.1 on ports 4100 to 4199. Tests make their own git repositories under the OS temp directory and remove them.

## Layout

- `src/md/`: the Markdown and ProseMirror document model, copied from spike 1 (see below).
- `src/core/`: `docsync.ts` (import, render, versions, authors), `diff.ts` (two-way block and word diff onto a Y fragment), `versions.ts` (version ring, base choice).
- `src/daemon/`: `daemon.ts` (serial queue, guarded writes, watcher, persistence, restart, git handling, events), `git.ts`, `cli.ts`.
- `src/relay/`: a Hocuspocus 4 relay for tests, with `gc: false`.
- `src/testkit/`: remote client and editor stand-in, temp repositories, save styles, tokens.
- `gates/`: one file per gate, `fuzz.ts`, `index.ts` (runs all, prints the table).
- `test/`: vitest suites for the core and the daemon.
- `fixtures/half-typed.json`: 47 half-typed Markdown states for gate F.

## Origin of copied code

- `src/md/`, `corpus/` (manifest, handwritten files, specs list) and `scripts/fetch-corpus.mjs`: copied from spike 1, `origin/spike/2026-09-27-markdown-round-trip` at `1e1f4a6`, directory `spikes/2026-09-27-markdown-core-remark-splice/`.
- `src/core/diff.ts`: started as a copy of spike 2's `src/diff.ts`, `origin/spike/2026-09-27-crdt-rebase` at `88bd85c`, directory `spikes/2026-09-27-crdt-rebase-yjs-fork/`, then extended for spike 1's schema and rewritten in its alignment (see the file's comments).

## Changes to copied code

Changes made in this spike to the `src/md/` files copied from spike 1. Everything else in `src/md/` is unmodified.

- **`src/md/parse.ts`, `src/md/serialize.ts` (brief 04): the `parseBlock` isolation re-parse cache persists across calls instead of being cleared every time.** On the 240 KB corpus file (`nodejs-node-docapinapimd.md`, 1619 top-level blocks) `parseMarkdown` and `serializeDoc` each cost about 1.3 s. Spike 1's cache (keyed by the exact definitions context and block source) was cleared at the start of every `serializeDoc` and the end of every `parseMarkdown`, so it never survived from one daemon operation to the next, although a save leaves all but one block byte-identical. Both clearing calls are removed and the caches are bounded LRUs (8000 and 500 entries). Effect: parse 1308 to about 150 ms, serialize 1264 to about 150 ms. `test/md-roundtrip.test.ts` proves the output is byte-identical with a cold or warm cache on every handwritten file and the 240 KB file.
- **`src/md/index.ts`: exports `clearParseBlockCache`** for that test.
