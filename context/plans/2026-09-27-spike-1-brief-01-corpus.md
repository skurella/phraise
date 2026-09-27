# Brief 01: corpus manifest, fetch script, hand-written edge cases

Status: done
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 1 plan](2026-09-27-spike-1-plan-markdown-round-trip.md)
Worker: grinder (Haiku)

## Goal

Build the test corpus for the Markdown round-trip spike (decision D4): a committed manifest of real-world Markdown files pinned to commit SHAs, a script that downloads them into a git-ignored directory, and committed hand-written edge-case files. Third-party file contents must never be committed.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-af7320636299cd0d4`, subdirectory `spikes/2026-09-27-markdown-core-remark-splice/`. Create it if missing. Only create files under `corpus/`, `scripts/`, and `.gitignore` inside it, plus your log.

## Inputs

- `AGENTS.md` (conventions, logging).
- This brief. Nothing else is needed.

## Deliverables

### 1. `corpus/manifest.json`

A JSON array. Each entry:
```json
{ "id": "npm-express-readme", "kind": "readme", "repo": "expressjs/express", "sha": "<40-hex commit sha>", "path": "Readme.md", "license": "MIT", "url": "https://raw.githubusercontent.com/expressjs/express/<sha>/Readme.md", "bytes": 12345, "sha256": "<hex sha256 of the file bytes>" }
```
Target 240 to 280 entries, all fetched successfully at least once by you, all with a permissive license: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, CC0-1.0. Skip anything else.

Sources, roughly:
- **About 160 READMEs** of popular npm packages. The npm registry (`https://registry.npmjs.org/<pkg>`) gives `license`, `repository.url` and, per version, `gitHead` (the commit SHA). Use the latest version's `gitHead`. The README path is usually `README.md`, sometimes `readme.md` or `Readme.md`; try those against raw.githubusercontent.com at that SHA and skip the package if none works or `gitHead` is missing. Mix big frameworks, small utilities, CLIs, and monorepos. Aim for a variety of sizes (a few over 30 KB).
- **About 100 design documents**, via the GitHub API (unauthenticated, 60 requests per hour, so be frugal: one `GET /repos/{o}/{r}` for license and default branch, one `GET /repos/{o}/{r}/commits/{branch}` for the SHA, one `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` for paths):
  - `rust-lang/rfcs`, files `text/*.md`: about 30
  - `golang/proposal`, files `design/*.md`: about 25
  - `kubernetes/enhancements`, files `keps/**/README.md`: about 25
  - `nodejs/node`, files `doc/api/*.md`: about 10, including a couple of large ones
  - `emberjs/rfcs` `text/*.md` or another permissively licensed RFC repo if its license qualifies: about 10
  Check each repo's license from the API; skip a repo that is not permissive and pick another RFC or docs repo that is.
- Deterministic selection: sort candidate paths and take every k-th so the choice is reproducible, and write down the rule in the README.

### 2. `corpus/specs.json`

Two entries describing the spec example sources, pinned by SHA:
- CommonMark spec examples: `commonmark/commonmark-spec`, file `spec.txt`.
- GFM spec examples: `github/cmark-gfm`, file `test/spec.txt`.
Each with repo, sha, path, license, url, sha256.

### 3. `scripts/fetch-corpus.mjs`

Plain Node 22 ESM, no dependencies. Run as `node scripts/fetch-corpus.mjs` from the spike directory.
- Downloads every manifest entry to `corpus/fetched/real/<id>.md`, writing the **exact bytes** (use `arrayBuffer`, never text decoding and re-encoding), verifies `sha256`, fails loudly on mismatch.
- Downloads both spec files and extracts every example into `corpus/fetched/commonmark/<NNNN>.md` and `corpus/fetched/gfm/<NNNN>.md`. Spec examples are delimited by a line of 32 backticks followed by ` example` (possibly with extra words such as ` example autolink`) and a closing line of 32 backticks; the Markdown input is the part before the line containing a single `.`. Replace the `→` character with a tab. Number examples from 1 in file order, zero-padded to 4 digits.
- Skips files already present with the right hash, runs downloads with modest concurrency (8), prints a summary: counts fetched, skipped, failed.
- Exit code non-zero if anything failed.

### 4. `.gitignore` in the spike directory

Contains `corpus/fetched/` and `node_modules/`.

### 5. Hand-written edge cases in `corpus/handwritten/`, committed

Small files, one construct focus each, realistic prose around it (at least one normal paragraph with several ordinary words in every file). Names and required content:

| File | Must contain |
|---|---|
| `crlf.md` | CRLF line endings throughout (write bytes explicitly), heading, paragraph, list, code fence |
| `no-trailing-newline.md` | a normal file whose last byte is not a newline |
| `trailing-blank-lines.md` | ends with three newlines |
| `tabs.md` | tab-indented code block, list items indented with tabs, tabs inside a paragraph |
| `nested-mixed-markers.md` | nested lists 3 levels deep mixing `-`, `*`, `+` and ordered `1.` and `1)` |
| `hard-breaks.md` | hard line breaks with two trailing spaces and with backslash |
| `front-matter-yaml.md` | YAML front matter then content |
| `front-matter-toml.md` | TOML `+++` front matter then content |
| `raw-html.md` | HTML blocks (`<div>`, `<details><summary>`, an HTML comment), inline HTML like `<kbd>` and `<br>` |
| `mdx-like.md` | `import X from './x'` line, JSX blocks like `<Tabs>\n<TabItem value="a">\n\ntext\n\n</TabItem>\n</Tabs>`, `export const meta = {}` |
| `math.md` | `$$` display math block, inline `$x^2$` |
| `footnotes.md` | footnote references and multi-paragraph footnote definitions |
| `reference-links.md` | full, collapsed and shortcut reference links, reference images, definitions with titles |
| `mermaid.md` | two mermaid fences, one with backticks, one with tildes |
| `tables.md` | GFM tables with left, center, right alignment, inline code and escaped pipes in cells |
| `task-lists.md` | GFM task list, checked and unchecked, nested |
| `setext-headings.md` | setext `===` and `---` headings |
| `style-star-bullets.md` | only `*` bullets, `_` emphasis, `__` strong, `~~~` fences, setext headings |
| `style-plus-bullets.md` | only `+` bullets, `*` emphasis, `**` strong, backtick fences of length 4, closed ATX headings like `## Title ##` |
| `style-dash-underscore.md` | `-` bullets, `_` emphasis, `**` strong, ATX headings, `***` thematic breaks |
| `blockquotes.md` | nested blockquotes, a list inside a blockquote, lazy continuation lines |
| `indented-code.md` | indented code blocks, a fenced block with info string `js title="x.js"` |
| `autolinks.md` | `<https://example.com>`, bare `https://example.com` and `www.example.com` literals, email autolink |
| `entities-escapes.md` | `&amp;`, `&copy;`, `&#123;`, backslash escapes like `\*not emphasis\*` and `\_` |
| `long-paragraphs.md` | paragraphs hard-wrapped at 80 columns, and one paragraph with one sentence per line |
| `emphasis-mix.md` | nested `***bold italic***`, `**bold _italic_**`, `~~strike~~`, intraword `snake_case_words` |
| `ordered-lists.md` | ordered lists starting at 3, lists using `)` delimiter, all `1.` numbering, loose and tight |
| `html-comments.md` | `<!-- prettier-ignore -->` and multi-line comments between blocks |

## Definition of done

- `node scripts/fetch-corpus.mjs` from the spike directory exits 0 on a clean `corpus/fetched/`, run twice (second run skips everything).
- `corpus/manifest.json` has 240 to 280 entries, every one permissive, every sha 40 hex characters.
- `ls corpus/fetched/commonmark | wc -l` is 652 or close (report the exact count), same for gfm (report it).
- `git status` shows no files under `corpus/fetched/`.
- `corpus/README.md` explains sources, selection rules, licenses and how to fetch.
- Hand-written files exist as listed; `crlf.md` really contains `\r\n` (check with `od -c | head`).

## Constraints

- Model: Haiku. Budget: about 90 minutes of work.
- The Bash sandbox is off for this session; network and git work normally.
- Commit your work on the current branch (`spike/2026-09-27-markdown-round-trip`) with a clear message when done; do not push. Never commit `corpus/fetched/`.
- Do not launch further agents.
- Keep a log at `context/logs/2026-09-27-grinder-spike-1-corpus.md` per AGENTS.md.

## Handback, under 300 words

Outcome, counts per source, exact spec example counts, anything skipped and why, commit SHA, log path.
