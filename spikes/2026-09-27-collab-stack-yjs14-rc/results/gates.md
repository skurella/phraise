# Stack 14 gate results

Generated 2026-09-27T07:33:15.470Z. Full run.

| Gate | Result | Numbers |
|---|---|---|
| A. Relay | PASS | median round-trip latency (20 single-char edits): 23.5ms |
| B. Schema fidelity | PASS | editor1 = editor2 = relay; every linked image kept its mark; update count stable at 23 |
| C. Corpus round trip (no workaround needed) | FAIL | path A (server-seeded): 266/266; path B (client-loaded): 234/266; 62.6s; encoded state (path A, summed): 18.70MB (spike 1's plain-y-prosemirror A3: 160/294; stack 13's gate C: 265/266 path A, 266/266 path B) |
| D. (later brief) | not run | - |
| E. (later brief) | not run | - |
| F. (later brief) | not run | - |
| G. (later brief) | not run | - |
| H. Maturity (Yjs 13/14 compatibility probe) | not run | see README / log: separate compat/ subpackage, task 6 |

## Gate C failures

- `npm-axios-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-base64-js-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-bcryptjs-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-canvas-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-cesium-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-commitlint-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-compression-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-cors-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
- `npm-eventemitter3-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-express-validator-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-fastify-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-gatsby-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-graphql-request-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-hexo-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-karma-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-ky-readme.md`: pathA=true, pathB=false (serializeDoc: block 2 (paragraph) has no serialization that re-parses to the edited block)
- `npm-minimist-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
- `npm-mobx-readme.md`: pathA=true, pathB=false (serializeDoc: block 3 (paragraph) has no serialization that re-parses to the edited block)
- `npm-mqtt-readme.md`: pathA=true, pathB=false (serializeDoc: block 0 (heading) has no serialization that re-parses to the edited block)
- `npm-multer-readme.md`: pathA=true, pathB=false (serializeDoc: block 0 (heading) has no serialization that re-parses to the edited block)
- `npm-nanoclone-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
- `npm-nock-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-node-cron-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-nodemailer-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-nodemon-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-nunjucks-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-oclif-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-pino-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-recharts-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-sequelize-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-ts-node-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-url-parse-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
