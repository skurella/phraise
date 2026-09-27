# src/git

Everything the relay needs from git against a remote that is a local bare
repository, using the git CLI. No Yjs, no Markdown knowledge: files are
strings or bytes. Serves D2 (as amended after spike 4: drafts by
`git push --force-with-lease`, one ref per branch, parented on the base
commit) and D6 (commit only if the head is the expected one,
`Co-authored-by` trailers). Plan section 5; brief 02.

Standalone module: does not import `src/crdt`, `src/markdown` or `src/engine`
(enforced by `test/import-boundary.test.ts`).

## Public API (`index.ts`)

`GitStore`, constructed with `{cacheDir, remoteUrl}`:

- `init()` -- creates the bare cache repository at `cacheDir` if absent and
  points its `origin` remote at `remoteUrl`. Call once before any other
  method.
- `remoteHead(branch): Promise<string | null>` -- `git ls-remote` of
  `refs/heads/<branch>`.
- `fetch(branch): Promise<void>` -- fetches `refs/heads/<branch>` and
  `refs/phraise/drafts/<branch>` into the cache. See "Deviations from the
  brief" below for why this is two separate `git fetch` calls and why the
  draft ref is force-fetched.
- `readFile(commit, path)` / `readBlob(commit, path)` -- the file at `path`
  in `commit`'s tree, as text or as raw bytes; `undefined` if it does not
  exist there.
- `commitInfo(commit) -> {parents, author: {name, email}, message}`,
  `changedPaths(a, b) -> string[]`, `isAncestor(a, b) -> boolean`.
- `writeDraft({branch, base, files, sidecar, expected}) -> {ok: true,
  commit} | {ok: false, reason: 'stale', actual}` -- the draft commit's
  first parent is `base`; its tree is `base`'s tree with each `files` entry
  written at its path. The second parent is a parentless commit whose tree
  holds each `sidecar` entry under `.phraise/`. Pushed under
  `--force-with-lease` (a CAS on `expected`; `expected: null` asserts the
  ref does not exist yet). A lease failure returns `{ok: false, reason:
  'stale', actual}` (the remote's current value, or `null` if the ref does
  not exist) -- it never throws.
- `readDraft(branch) -> {commit, base, files, sidecar} | null` -- always
  fetches first, so it reflects the remote's current state. `files` lists
  only the paths whose blob differs from `base` (`git diff --name-only base
  draft`); `sidecar` comes from the second parent's tree with the
  `.phraise/` prefix stripped back off.
- `deleteDraft(branch, expected) -> {ok: true} | {ok: false, reason:
  'stale', actual}` -- deletes the draft ref under a lease.
- `commit({branch, expectedHead, files, author, message, coAuthors}) ->
  {ok: true, commit} | {ok: false, reason: 'stale', actual}` -- tree =
  `expectedHead`'s tree with `files` replaced; parent = `expectedHead`;
  message = `message` plus one deduplicated `Co-authored-by: Name <email>`
  trailer per `coAuthors` entry, excluding the author. Pushed under
  `--force-with-lease` against `expectedHead`; a lease failure is returned,
  never thrown.

Every object is created with plumbing in the bare cache (`gitProcess.ts`,
`plumbing.ts`): `hash-object -w --stdin`, a scratch index file selected via
`GIT_INDEX_FILE` per call (`read-tree`, `update-index --add --cacheinfo`,
`write-tree`), `commit-tree` with author/committer set through environment
variables. No working tree is ever used in the cache. Every git call is
`execFile`/`spawn` with an argument array (no shell), `GIT_TERMINAL_PROMPT=0`,
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, and a timeout.

## Deviations from the brief

Found by experiment (a throwaway Node script under `os.tmpdir()`, logged in
`context/logs/2026-09-27-builder-spike-6-git-storage.md`), not by design
preference:

1. **The draft ref is fetched with a `+` (force) refspec.** The brief:
   "explicit refspecs, no `+` on the draft ref is fine for fetch since fetch
   into the cache mirrors the remote." Tested: after a draft is rewritten to
   a *sibling* of the cache's previously-fetched draft commit (same base,
   different content -- exactly what a relay's second draft flush produces,
   since both are parented on the same branch head), a plain fetch refspec
   is rejected as non-fast-forward and the cache's local ref does not move.
   `+` is needed. This is safe here: the spike-4 pitfall is `+` on a *push*
   refspec silently defeating `--force-with-lease`'s CAS; on a *fetch* it
   only lets the cache's disposable, read-only mirror ref move
   non-fast-forward, which is exactly what mirroring a force-pushed ref
   requires. The branch ref is force-fetched too, for the same reason
   (harmless: the cache never pushes from this ref, only reads it).
2. **The branch ref and the draft ref are fetched in two separate `git
   fetch` calls, not one call with two refspecs.** A single call is
   all-or-nothing: when the draft ref does not exist yet on the remote (the
   ordinary case before any draft has been written) the whole command fails
   with `fatal: couldn't find remote ref ...` and *also* fails to fetch the
   branch ref, which did exist and was otherwise fetchable. `fetch()` treats
   a missing-ref failure on the draft call alone as "no draft" (not an
   error) and clears the cache's local draft ref in that case, so a
   previously-fetched, since-deleted draft is never read back as if it were
   still current.

## What it may import

`node:child_process`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`.
Nothing from `src/crdt`, `src/markdown` or `src/engine`.

## Origin of copied code

None -- every file in this module is new for this spike (brief 02). The
subprocess-wrapper style (`execFile`, promisified, `{cwd, encoding: 'utf8'}`)
follows spike 3's `src/daemon/git.ts`, but no code was copied from it: that
module is read-only (never a mutating git command) and has no plumbing,
push, or lease handling to draw from.
