# Corpus: Block-Preserving Markdown Round-Trip Test Data

This directory contains test data for the Markdown round-trip spike: real-world Markdown files pinned by commit SHA and hand-written edge cases covering syntax variants.

## Contents

- `manifest.json`: Pinned references to 280 real-world Markdown files (183 npm READMEs + 97 design documents)
- `specs.json`: CommonMark and GFM spec files used to extract examples
- `handwritten/`: 26 committed edge-case Markdown files covering specific constructs
- `fetched/`: Downloaded files (git-ignored), organized by source

## Sources

### npm READMEs (183 files)

Popular Node.js packages covering:
- Frameworks: React, Vue, Angular, Next, Nuxt, Remix, Astro, Svelte
- Testing: Jest, Mocha, Vitest, Playwright, Cypress
- Build tools: Webpack, Rollup, Vite, Esbuild
- Data/serialization: Lodash, Ramda, GraphQL, YAML, TOML
- HTTP clients and servers: Express, Axios, Node-fetch, Got, Koa, Fastify, Hapi, Nest
- Databases: Prisma, TypeORM, Sequelize, Knex
- Database drivers: pg, mysql2, better-sqlite3
- Auth: Passport, jsonwebtoken, Auth0, Next-auth
- Markdown/docs: Marked, Remark, Unified, Gray-matter, MDX, Docusaurus, Vitepress
- UI libraries: Material-UI, Chakra-UI, Styled-components, Emotion
- Utilities: Chalk, Inquirer, Commander, Yargs, Lodash, Semver, UUID, Nanoid
- And many others covering CLIs, databases, async, encoding, and cloud SDKs

Each entry uses the latest version's `gitHead` commit SHA from the npm registry.

### Design Documents (97 files)

From permissively licensed RFC/design doc repositories:

- **rust-lang/rfcs** (30 files): `text/*.md` - Rust language RFCs
- **golang/proposal** (25 files): `design/*.md` - Go language proposals
- **kubernetes/enhancements** (25 files): `keps/**/README.md` - Kubernetes Enhancement Proposals
- **nodejs/node** (10 files): `doc/api/*.md` - Node.js API documentation
- **emberjs/rfcs** (7 files): `text/*.md` - Ember.js RFCs

Selection rule: Files are sorted deterministically within each repo and category. Every k-th file is selected where k = ceil(total / target count), ensuring reproducible selection across runs.

### Spec Examples

- **CommonMark** (`commonmark/commonmark-spec`): 655 examples from `spec.txt`
- **GFM** (`github/cmark-gfm`): 672 examples from `test/spec.txt`

Examples are extracted by parsing spec delimiter lines (32+ backticks + ` example`) and content markers (single `.` on a line). The tab character (`→` in specs) is normalized to actual tabs. Examples are saved as `<NNNN>.md` numbered from 0001 in file order.

### Hand-Written Edge Cases (26 files)

Committed files covering specific constructs and edge cases:

| File | Content |
|------|---------|
| `crlf.md` | CRLF line endings throughout |
| `no-trailing-newline.md` | File without final newline |
| `trailing-blank-lines.md` | Ends with three newlines |
| `tabs.md` | Tab indentation in code and lists, inline tabs |
| `nested-mixed-markers.md` | 3-level nested lists with mixed markers (-, *, +, 1., 1)) |
| `hard-breaks.md` | Hard line breaks with two spaces and backslash |
| `front-matter-yaml.md` | YAML frontmatter |
| `front-matter-toml.md` | TOML frontmatter with `+++` delimiters |
| `raw-html.md` | HTML blocks, comments, and inline tags |
| `mdx-like.md` | JSX-like blocks and import/export statements |
| `math.md` | LaTeX display and inline math with `$$` and `$` |
| `footnotes.md` | Footnote references and multi-paragraph definitions |
| `reference-links.md` | Full, collapsed, and shortcut reference links; images |
| `mermaid.md` | Mermaid diagram fences (backticks and tildes) |
| `tables.md` | GFM tables with alignment, code, escaped pipes |
| `task-lists.md` | GFM task lists, checked/unchecked, nested |
| `setext-headings.md` | Setext-style headings (===, ---) |
| `style-star-bullets.md` | Style: `*` bullets, `_` emphasis, `__` strong, `~~~` fences |
| `style-plus-bullets.md` | Style: `+` bullets, `*` emphasis, `**` strong, 4-backtick fences, `##` closed ATX |
| `style-dash-underscore.md` | Style: `-` bullets, `_` emphasis, `**` strong, `***` breaks |
| `blockquotes.md` | Nested blockquotes, lists in quotes, lazy continuation |
| `indented-code.md` | Indented code blocks, fenced block with info string |
| `autolinks.md` | URL autolinks, bare URLs, www links, email autolinks |
| `entities-escapes.md` | HTML entities and backslash escapes |
| `long-paragraphs.md` | Hard-wrapped paragraphs at 80 columns; one sentence per line |
| `emphasis-mix.md` | Nested emphasis (`***`, `**_`), strikethrough, intraword |
| `ordered-lists.md` | Start offset, paren delimiter, all 1., loose and tight |
| `html-comments.md` | HTML comments between blocks |

## Licenses

All entries use permissive licenses:

- **MIT**: ~160 entries (most common)
- **ISC**: ~40 entries
- **BSD-2-Clause**: ~20 entries
- **BSD-3-Clause**: ~15 entries
- **Apache-2.0**: ~10 entries
- **0BSD**, **Unlicense**, **CC0-1.0**, **CC-BY-SA-4.0**: Remaining entries

Detailed license info is in `manifest.json` and `specs.json` per entry.

## Fetching the Corpus

Run from the spike directory:

```bash
node scripts/fetch-corpus.mjs
```

The script:
1. Downloads every manifest entry to `corpus/fetched/real/<id>.md`, preserving exact bytes
2. Verifies SHA256 hash against the manifest, exits non-zero on mismatch
3. Downloads spec files and extracts examples to `corpus/fetched/commonmark/<NNNN>.md` and `corpus/fetched/gfm/<NNNN>.md`
4. Skips files already present with correct hash (safe to re-run)
5. Uses 8 concurrent downloads with modest retries
6. Prints a summary and exits 0 on success or non-zero if anything failed

Expected counts after fetch:
- `corpus/fetched/real/`: 280 files (manifest entries)
- `corpus/fetched/commonmark/`: 655 files (examples numbered 0001-0655)
- `corpus/fetched/gfm/`: 672 files (examples numbered 0001-0672)

## Usage in Tests

The corpus is designed for gate testing (spike 1 plan tasks 3-6):

- **Gate A**: `serialize(parse(x)) === x` for every manifest file and hand-written file, bytes compared
- **Gate B**: Random word replacement in paragraphs with diff contained within source line range
- **Gate C**: Pass rates filtered by construct type (tables, math, etc.)
- **Gate D**: Schema checks and Yjs round trips
- **Gate E**: Forced re-serialization with style detection

See `../plans/2026-09-27-spike-1-plan-markdown-round-trip.md` for details.
