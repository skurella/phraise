# Brief 02: git storage module

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md), section 5 is the spec for this brief; section 2 for layout.
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md), section "Rules for every agent in this spike" applies to you in full.

## Goal

Build `src/git/`: everything the relay needs from git, against a remote that is a local bare repository, using the git CLI. Plus testkit helpers that create such remotes and act as "someone else" pushing to them. Serves D2 (as amended after spike 4: drafts by `git push --force-with-lease`, one ref per branch, parented on the base commit) and D6 (commit only if the head is the expected one, `Co-authored-by` trailers).

## Inputs to read

- `AGENTS.md`, this brief, plan sections 2 and 5.
- `context/docs/2026-09-27-spike-4-findings-github-storage.md`, section "D. Race detection" only (the `+` refspec pitfall and lease semantics).
- The existing package `spikes/2026-09-27-integration-engine/` (README, `package.json`, `src/testkit/`), built by brief 01. Do not change `src/markdown` or `src/crdt`.
- `$REF/2026-09-27-daemon-file-sync-fork-import/src/daemon/git.ts` and `src/testkit/temp-repo.ts` (plan section 1 gives `$REF`) for how spike 3 shelled out to git.

## API to build (adjust names if you must, and say so in the module README)

`src/git/index.ts` exports a `GitStore` class, constructed with `{cacheDir, remoteUrl}`, no Yjs, no Markdown knowledge (files are strings or bytes):

- `init()`: creates the bare cache repository if absent, sets the remote.
- `remoteHead(branch): Promise<string | null>` via `git ls-remote`.
- `fetch(branch)`: fetches `refs/heads/<branch>` and `refs/phraise/drafts/<branch>` into the cache (explicit refspecs, no `+` on the draft ref is fine for fetch since fetch into the cache mirrors the remote).
- `readFile(commit, path): Promise<string | undefined>`, `readBlob`, `commitInfo(commit) -> {parents, author: {name, email}, message}`, `changedPaths(a, b)`, `isAncestor(a, b)`.
- `writeDraft({branch, base, files: Record<path, string>, sidecar: Record<path, Uint8Array>, expected: string | null}) -> {ok: true, commit} | {ok: false, reason: 'stale', actual: string | null}`. Draft commit shape per plan section 5: first parent `base`; tree = `base`'s tree with each `files` entry written at its path; second parent = a parentless commit whose tree holds `sidecar` entries under `.phraise/`. Push with `--force-with-lease=refs/phraise/drafts/<branch>:<expected or empty>` and a refspec without `+`. A lease failure returns `stale` with the remote's actual value; never throw for it.
- `readDraft(branch) -> {commit, base, files: Record<path, string>, sidecar: Record<path, Uint8Array>} | null`, where `files` lists only paths whose blob differs from `base`, and the sidecar comes from the second parent.
- `deleteDraft(branch, expected)` with a lease.
- `commit({branch, expectedHead, files: Record<path, string>, author: {name, email}, message, coAuthors: {name, email}[]}) -> {ok: true, commit} | {ok: false, reason: 'stale', actual}`. Tree = `expectedHead`'s tree with the files replaced; parent `expectedHead`; message followed by a blank line and one `Co-authored-by: Name <email>` line per co-author (deduplicated, excluding the author); push `<commit>:refs/heads/<branch>` with `--force-with-lease=refs/heads/<branch>:<expectedHead>`.
- Objects are created with plumbing in the bare cache: `hash-object -w --stdin`, a temporary index file via `GIT_INDEX_FILE` (`read-tree`, `update-index --add --cacheinfo`, `write-tree`), `commit-tree` with author and committer set through environment variables. Never use a working tree in the cache.
- Every git call is `execFile` with an argument array (no shell), with `GIT_TERMINAL_PROMPT=0` and a sanitized environment that cannot pick up the user's global hooks or signing config (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`), and a timeout.

`src/testkit/remote.ts`:
- `makeRemote({files, branch?, author?}) -> {url, dir, cleanup}`: a bare repo under `$TMPDIR` with one initial commit on `main`.
- `makeClone(url) -> Clone` with `write(path, text)`, `commitAndPush(message, author)`, `pull()`, `head()`, `git(args)`, `cleanup()`. This is how tests play "someone else pushes a commit".

## Tasks, in order. Stop when task 5 is done.

1. `src/git/` with the API above and a `README.md`.
2. `src/testkit/remote.ts`.
3. Unit tests in `test/git.*.test.ts`, all against temp bare repos:
   - `remoteHead` sees a push from a clone;
   - `writeDraft` then, in a separate plain clone, `git fetch origin refs/phraise/drafts/main:refs/draft` and `git diff --name-only main refs/draft` lists exactly the Markdown paths written, no `.phraise/` paths; `git diff main refs/draft` shows the changed lines;
   - `readDraft` returns the same files and byte-identical sidecar data;
   - a draft written with a stale `expected` is rejected and the remote draft is unchanged; one with the right `expected` succeeds; a create with `expected: null` when the ref exists is rejected;
   - the draft commit's first parent is `base`;
   - `commit` with the right `expectedHead` succeeds, the author is as given, the message ends with the trailers, and `git log --format=%(trailers:key=Co-authored-by)` in a plain clone shows them; `commit` after someone else pushed is rejected with `stale` and the branch is unchanged;
   - no git process is left running after the tests.
4. Add `src/git` to the import-boundary test: it must not import `yjs` or anything from `src/crdt`.
5. `npm test` and `npm run typecheck` pass. Update the package `README.md` layout section for `src/git`.

## Definition of done

`npm test` passes with the new git tests included; `npm run typecheck` clean.

## Constraints

- Only add new files, except the package's own `README.md`, `test/import-boundary.test.ts` and `src/testkit/README.md`, which you may edit.
- Log: `context/logs/2026-09-27-builder-spike-6-git-storage.md`. Do not commit.
- Bash in this environment refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs. Run git commands as single plain commands, with `git -C <dir>` if needed. Prefer the Write tool for files. Tests spawn git from Node, which is unaffected.
- No network, no GitHub. Temp repos only under `os.tmpdir()`.
- Handback under 300 words.
