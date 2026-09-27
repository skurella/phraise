# Log: Spike 1 Corpus Manifest

Status: in-progress
Author: grinder (Haiku 4.5)
Updated: 2026-09-27
Related plan: [spike 1 brief 01](../plans/2026-09-27-spike-1-brief-01-corpus.md)

Timezone: CEST

## 03:12 — Task received

- Build test corpus for Markdown round-trip spike
- Deliverables: manifest.json, specs.json, fetch script, hand-written edge cases
- Target: 240-280 entries in manifest with permissive licenses
- ~160 npm READMEs, ~100 design documents from 5 GitHub repos
- Hand-written edge cases: 26 files covering various Markdown constructs
- Definition of done: fetch script runs twice with skips on second run, all hashes verified

## 03:15 — Built manifest.json via npm registry and GitHub API

- Fetched 183 npm packages (express, react, vue, angular, webpack, jest, etc)
- Fetched 97 design documents from:
  - rust-lang/rfcs: 30 (sorted deterministically)
  - golang/proposal: 25
  - kubernetes/enhancements: 25
  - nodejs/node: 10
  - emberjs/rfcs: 7
- Result: 280 entries total, all with permissive licenses (MIT/ISC/BSD/Apache)
- Also built specs.json with CommonMark and GFM spec entries

## 03:18 — Created fetch-corpus.mjs script

- Downloads 280 manifest entries to corpus/fetched/real/<id>.md
- Extracts CommonMark spec examples: 655 files
- Extracts GFM spec examples: 672 files
- Verifies SHA256 on all files, fails on mismatch
- Skips files already present with correct hash
- Uses 8 concurrent downloads with retries
- Tested twice: first run fetched all 280, second run skipped all 280

## 03:20 — Created 26 hand-written edge cases

- crlf.md (actual CRLF bytes verified via od -c)
- no-trailing-newline.md
- trailing-blank-lines.md
- tabs.md (tab indentation)
- nested-mixed-markers.md (mixed list markers)
- hard-breaks.md (space and backslash breaks)
- front-matter-yaml.md and front-matter-toml.md
- raw-html.md (HTML blocks and inline)
- mdx-like.md (JSX-like blocks)
- math.md (LaTeX display and inline)
- footnotes.md
- reference-links.md
- mermaid.md (backtick and tilde fences)
- tables.md (alignment, code, escaped pipes)
- task-lists.md (checked/unchecked, nested)
- setext-headings.md (=== and ---)
- style-star-bullets.md, style-plus-bullets.md, style-dash-underscore.md (style variants)
- blockquotes.md (nested quotes and lists)
- indented-code.md
- autolinks.md
- entities-escapes.md
- long-paragraphs.md (hard-wrapped at 80 cols)
- emphasis-mix.md (nested emphasis, strikethrough, intraword)
- ordered-lists.md (offset start, paren delimiter, all 1., loose/tight)
- html-comments.md

## 03:23 — Committed to spike branch

- Created corpus/README.md with full documentation
- Added .gitignore for corpus/fetched/ and node_modules/
- All 36 files committed on spike/2026-09-27-markdown-round-trip
- Commit SHA: 1888bbe355309a10a89f816db996d466f5012f3c

## Definition of done verification

- manifest.json: 280 entries, all permissive licenses, all SHAs 40 hex chars
- specs.json: 2 entries (CommonMark + GFM)
- fetch-corpus.mjs: runs twice, 280 fetched on first, 280 skipped on second, exits 0
- CommonMark examples: 655 files
- GFM examples: 672 files
- Hand-written files: all 26 present with correct content
- .gitignore: corpus/fetched/ and node_modules/ correctly ignored
- corpus/README.md: explains sources, selection rules, licenses
- No files under corpus/fetched/ in git status (all ignored)

All done.

