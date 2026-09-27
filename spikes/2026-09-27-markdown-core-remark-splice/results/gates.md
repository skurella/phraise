# Gates results

Generated: 2026-09-27T04:19:54.205Z

| Gate | Threshold | Result | Pass |
|---|---|---|---|
| A. No-edit round trip, corpus files | 100% | 294/294 (100.0%) | yes |
| A2. JSON round trip, all files | 100% | 1621/1621 (100.0%) | yes |
| A3. Yjs round trip with plain y-prosemirror, all files (finding) | none, measured | 1473/1621 (90.9%), findings: 8 lost doc-level attrs (lead/eol), 136 lost marks on leaf inline nodes (e.g. linked images) | n/a |
| A3b. Yjs round trip through src/yjs.ts codec and a binary update, all files | 100% | 1621/1621 (100.0%) | yes |
| B. Single-word edit, corpus files (file pass rate) | 98% | 293/293 (100.0%) files, 1465/1465 (100.0%) edits | yes |
| B2. Structural edit (bold toggle), corpus files (file pass rate; finding) | none, measured | 293/293 (100.0%) files, 1465/1465 (100.0%) edits | n/a |
| C. Opaque/special constructs survive A and B | every file containing the construct passes A; B containment holds | frontmatter:2f, raw-html:156f, mdx:2f, math-block:1f, math-inline:5f, footnote-definition:2f, link-reference-definition:102f, mermaid:1f, fenced-code:219f, table:62f | yes |
| D. Editor-model fidelity | 100% | schema=prosemirror-model:true, doc.check() 1621/1621 (100.0%), edited doc.check() 5565/5565 (100.0%) | yes |
| E. Style detection, non-default files passing | >= 10 files | 145 files | yes |

## Gate A detail (no-edit round trip, per set)

| Set | Files | A pass | A2 pass | A3 pass |
|---|---|---|---|---|
| handwritten | 28 | 28/28 (100.0%) | 28/28 (100.0%) | 28/28 (100.0%) |
| real | 266 | 266/266 (100.0%) | 266/266 (100.0%) | 132/266 (49.6%) |
| commonmark | 655 | 655/655 (100.0%) | 655/655 (100.0%) | 648/655 (98.9%) |
| gfm | 672 | 672/672 (100.0%) | 672/672 (100.0%) | 665/672 (99.0%) |

Unstable (self-description-failed) top-level blocks across all files: 1.

**Finding 1**: gate A3 (Yjs round trip via y-prosemirror's `prosemirrorToYXmlFragment`/`yXmlFragmentToProseMirrorRootNode`) loses the *doc* node's own top-level attrs (`lead`, `eol`) -- the XmlFragment has no slot for the root node's own attrs, so they always come back at schema defaults. This affects any file with a non-empty `lead` (leading blank lines before the first block) or CRLF line endings. Affected files (8): real/npm-htm-readme, real/npm-typeorm-cli-readme, commonmark/0097, commonmark/0117, commonmark/0229, gfm/0067, gfm/0087, gfm/0197.

**Finding 2** (more impactful): the same y-prosemirror round trip also silently drops marks on non-text inline leaf nodes -- most commonly the `link` mark wrapping an `image` node, i.e. `[![alt](img)](href)` becomes `![alt](img)` (the outer link vanishes). Affected files (136): real/kubernetes-enhancements-kepssigapimachinery4153declarativeva, real/kubernetes-enhancements-kepssigapimachinery6164internaltypee, real/kubernetes-enhancements-kepssiginstrumentation4827components, real/kubernetes-enhancements-kepssignode1898hardenedexecreadmemd, real/kubernetes-enhancements-kepssignode2837podlevelresourcespecr, real/kubernetes-enhancements-kepssignode753sidecarcontainersreadm, real/kubernetes-enhancements-kepssigsecurity3203autorefreshingoff, real/npm-amazon-cognito-identity-js-readme, real/npm-auth0-js-readme, real/npm-ava-readme, real/npm-aws-sdk-readme, real/npm-axios-readme, real/npm-base64-js-readme, real/npm-bcryptjs-readme, real/npm-bee-queue-readme, ....

## Gate B detail (single-word edit, per set)

| Set | Files (n/a) | File pass rate | Edit pass rate | Single-line rate |
|---|---|---|---|---|
| handwritten | 28 (0 n/a) | 28/28 (100.0%) | 140/140 (100.0%) | 140/140 (100.0%) |
| real | 266 (1 n/a) | 265/265 (100.0%) | 1325/1325 (100.0%) | 1324/1325 (99.9%) |
| commonmark | 655 (252 n/a) | 402/403 (99.8%) | 2010/2015 (99.8%) | 2015/2015 (100.0%) |
| gfm | 672 (255 n/a) | 416/417 (99.8%) | 2080/2085 (99.8%) | 2085/2085 (100.0%) |

### Path distribution (all sets, all edits)

- splice: 5476
- textblock-splice: 79
- unverified: 10

### Failure categories (all sets, with one example each)

- **semantic-mismatch**: 10 -- e.g. commonmark/0039 seed 1, word "foo", path unverified: `foo&#10;&#10;bar`

## Gate B2 detail (structural edit: bold toggle, per set, informational)

| Set | Files (n/a) | File pass rate | Edit pass rate | Single-line rate |
|---|---|---|---|---|
| handwritten | 28 (0 n/a) | 28/28 (100.0%) | 140/140 (100.0%) | 140/140 (100.0%) |
| real | 266 (1 n/a) | 265/265 (100.0%) | 1325/1325 (100.0%) | 1286/1325 (97.1%) |
| commonmark | 655 (252 n/a) | 396/403 (98.3%) | 1989/2015 (98.7%) | 1905/2015 (94.5%) |
| gfm | 672 (255 n/a) | 409/417 (98.1%) | 2060/2085 (98.8%) | 1982/2085 (95.1%) |

### Path distribution (all sets, all edits)

- textblock-splice: 4616
- splice: 898
- unverified: 51

### Failure categories (all sets, with one example each)

- **semantic-mismatch**: 51 -- e.g. commonmark/0039 seed 1, word "foo", path unverified: `foo&#10;&#10;bar`

## Gate C detail (opaque/special constructs, real + handwritten)

| Construct | Files containing | Block count | A pass | B file pass rate | Cross-check preserved |
|---|---|---|---|---|---|
| frontmatter | 2 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 10/10 (100.0%) |
| raw-html | 156 | 5561 | 156/156 (100.0%) | 156/156 (100.0%) | 9605/9605 (100.0%) |
| mdx | 2 | 9 | 2/2 (100.0%) | 2/2 (100.0%) | 12/12 (100.0%) |
| math-block | 1 | 3 | 1/1 (100.0%) | 1/1 (100.0%) | 15/15 (100.0%) |
| math-inline | 5 | 15 | 5/5 (100.0%) | 5/5 (100.0%) | n/a (0 files) |
| footnote-definition | 2 | 5 | 2/2 (100.0%) | 2/2 (100.0%) | 25/25 (100.0%) |
| link-reference-definition | 102 | 1944 | 102/102 (100.0%) | 102/102 (100.0%) | 9715/9715 (100.0%) |
| mermaid | 1 | 2 | 1/1 (100.0%) | 1/1 (100.0%) | 10/10 (100.0%) |
| fenced-code | 219 | 3630 | 219/219 (100.0%) | 218/218 (100.0%) | 17675/17675 (100.0%) |
| table | 62 | 161 | 62/62 (100.0%) | 62/62 (100.0%) | 770/770 (100.0%) |

## Gate D detail (editor-model fidelity)

- Schema is a real `prosemirror-model` `Schema` instance: true
- `doc.check()` on every parsed document: 1621/1621 (100.0%)
- `doc.check()` on every gate-B-edited document: 5565/5565 (100.0%)
- Edits made via ProseMirror `Transaction`s (`EditorState.tr.insertText`): by construction, all of gate B's 5565 edits.
- A2 (JSON round trip) pass rate: 1621/1621 (100.0%)
- A3 (Yjs round trip) pass rate: 1473/1621 (90.9%) (8 due to finding 1, 136 due to finding 2 above)

## Gate E detail (style detection, real + handwritten)

Non-default files: 148 total, 145 passing the forced-reserialize convention check (threshold: >= 10 passing).

Failing non-default files (3): handwritten/style-plus-bullets, real/npm-base64-js-readme, real/npm-semver-readme

| File | Non-default conventions | Pass |
|---|---|---|
| handwritten/crlf | eol | yes |
| handwritten/setext-headings | headingStyle1, headingStyle2, setext | yes |
| handwritten/style-dash-underscore | emphasis, rule | yes |
| handwritten/style-plus-bullets | bullet, fenceLen, closeAtx | no |
| handwritten/style-star-bullets | bullet, emphasis, strong, fence, headingStyle1, setext | yes |
| real/golang-proposal-design11502securitypolicymd | bullet | yes |
| real/golang-proposal-design14386zippackagearchivesmd | emphasis | yes |
| real/golang-proposal-design15292201312typeparamsmd | bullet, emphasis | yes |
| real/golang-proposal-design17280profilelabelsmd | emphasis | yes |
| real/golang-proposal-design2981gotestjsonmd | bullet, emphasis | yes |
| real/golang-proposal-design40276goinstallmd | bullet | yes |
| real/golang-proposal-design43810gopmemmd | bullet | yes |
| real/golang-proposal-design45713workspacemd | bullet, emphasis | yes |
| real/golang-proposal-design48409softmemorylimitsrcmd | bullet | yes |
| real/golang-proposal-design55022pgoimplementationmd | bullet, emphasis, strong | yes |
| real/golang-proposal-design60078loopvarmd | emphasis | yes |
| real/golang-proposal-design6977overlappinginterfacesmd | emphasis | yes |
| real/golang-proposal-designdraftiofsmd | emphasis | yes |
| real/kubernetes-enhancements-kepssigapimachinery2334graduateserve | bullet | yes |
| real/kubernetes-enhancements-kepssigapimachinery4153declarativeva | emphasis | yes |
| real/kubernetes-enhancements-kepssigarchitecture917gomodulesreadm | bullet, emphasis | yes |
| real/kubernetes-enhancements-kepssigauth4872hardenkubeletcertvali | rule, ruleRepetition | yes |
| real/kubernetes-enhancements-kepssigcloudprovider1179buildingwith | emphasis | yes |
| real/kubernetes-enhancements-kepssigclusterlifecycleclusterapi249 | bullet, emphasis | yes |
| real/kubernetes-enhancements-kepssigclusterlifecyclewgs783compone | emphasis | yes |
| real/kubernetes-enhancements-kepssignode1898hardenedexecreadmemd | emphasis | yes |
| real/kubernetes-enhancements-kepssignode2837podlevelresourcespecr | bullet | yes |
| real/kubernetes-enhancements-kepssignode5532restartallcontainerso | bulletOrdered | yes |
| real/kubernetes-enhancements-kepssigscheduling1923prefernominated | emphasis | yes |
| real/kubernetes-enhancements-kepssigsecurity3203autorefreshingoff | strong | yes |
| real/kubernetes-enhancements-kepssigstorage559volumesubpathexpans | bullet | yes |
| real/nodejs-node-docapiaddonsmd | bullet, emphasis | yes |
| real/nodejs-node-docapiclimd | bullet, emphasis | yes |
| real/nodejs-node-docapidiagnosticschannelmd | bullet | yes |
| real/nodejs-node-docapierrorsmd | bullet, emphasis | yes |
| real/nodejs-node-docapihttp2md | bullet, emphasis | yes |
| real/nodejs-node-docapinapimd | bullet, emphasis | yes |
| real/nodejs-node-docapiprocessmd | bullet, emphasis | yes |
| real/nodejs-node-docapisingleexecutableapplicationsmd | bullet, emphasis | yes |
| real/nodejs-node-docapitlsmd | bullet, emphasis | yes |
| real/nodejs-node-docapivfsmd | bullet | yes |
| real/npm-axios-readme | emphasis | yes |
| real/npm-base64-js-readme | bullet, headingStyle1 | no |
| real/npm-bee-queue-readme | emphasis | yes |
| real/npm-body-parser-readme | bullet, emphasis | yes |
| real/npm-browserslist-readme | emphasis | yes |
| real/npm-bull-readme | emphasis | yes |
| real/npm-canvas-readme | bullet | yes |
| real/npm-chai-readme | emphasis | yes |
| real/npm-changesets-readme | bullet | yes |
| real/npm-chrono-node-readme | bullet, emphasis | yes |
| real/npm-commander-readme | emphasis | yes |
| real/npm-compression-readme | emphasis | yes |
| real/npm-cross-env-readme | emphasis | yes |
| real/npm-d3-readme | bullet | yes |
| real/npm-dayjs-readme | bullet | yes |
| real/npm-debug-readme | emphasis, strong | yes |
| real/npm-dotenv-readme | bullet | yes |
| real/npm-echarts-readme | bullet | yes |
| real/npm-enquirer-readme | emphasis, rule | yes |
| real/npm-env-var-readme | bullet | yes |
| real/npm-eslint-readme | emphasis | yes |
| real/npm-expo-readme | emphasis | yes |
| real/npm-express-http-proxy-readme | bullet | yes |
| real/npm-express-readme | bullet | yes |
| real/npm-fast-deep-equal-readme | strong | yes |
| real/npm-fast-glob-readme | bullet | yes |
| real/npm-fastify-readme | emphasis, strong | yes |
| real/npm-firebase-readme | emphasis | yes |
| real/npm-flatted-readme | bullet, emphasis | yes |
| real/npm-fp-ts-readme | emphasis | yes |
| real/npm-fs-extra-readme | headingStyle1, headingStyle2, setext | yes |
| real/npm-glob-readme | emphasis | yes |
| real/npm-graphql-readme | emphasis | yes |
| real/npm-graphql-request-readme | emphasis | yes |
| real/npm-gray-matter-readme | bullet, emphasis, rule | yes |
| real/npm-htm-readme | emphasis | yes |
| real/npm-http-proxy-readme | bullet | yes |
| real/npm-immer-readme | emphasis | yes |
| real/npm-jest-readme | emphasis | yes |
| real/npm-jsdom-readme | emphasis | yes |
| real/npm-jsonwebtoken-readme | bullet, emphasis | yes |
| real/npm-karma-readme | bullet, emphasis | yes |
| real/npm-koa-readme | emphasis, strong | yes |
| real/npm-ky-readme | emphasis | yes |
| real/npm-less-readme | bullet | yes |
| real/npm-lint-staged-readme | emphasis | yes |
| real/npm-mailgun-js-readme | bullet, emphasis | yes |
| real/npm-mdx-readme | bullet | yes |
| real/npm-memcached-readme | bullet | yes |
| real/npm-mime-types-readme | strong | yes |
| real/npm-minimist-readme | bullet | yes |
| real/npm-mobx-readme | emphasis | yes |
| real/npm-mocha-readme | emphasis | yes |
| real/npm-mqtt-readme | emphasis | yes |
| real/npm-nanoid-readme | emphasis | yes |
| real/npm-nock-readme | emphasis | yes |
| real/npm-node-fetch-readme | emphasis | yes |
| real/npm-node-schedule-readme | bullet | yes |
| real/npm-p-retry-readme | emphasis | yes |
| real/npm-passport-readme | emphasis | yes |
| real/npm-pg-readme | emphasis | yes |
| real/npm-pino-readme | bullet | yes |
| real/npm-playwright-readme | bullet | yes |
| real/npm-postcss-readme | emphasis | yes |
| real/npm-prompts-readme | bullet, rule | yes |
| real/npm-protobufjs-readme | bullet | yes |
| real/npm-ramda-readme | bullet, headingStyle1, headingStyle2, setext | yes |
| real/npm-react-dom-readme | bullet | yes |
| real/npm-react-readme | bullet | yes |
| real/npm-react-redux-readme | emphasis | yes |
| real/npm-redis-readme | emphasis | yes |
| real/npm-redux-readme | emphasis | yes |
| real/npm-rimraf-readme | emphasis | yes |
| real/npm-rollup-readme | emphasis | yes |
| real/npm-sass-readme | bullet | yes |
| real/npm-semver-readme | bullet, headingStyle1 | no |
| real/npm-stripe-readme | emphasis | yes |
| real/npm-tap-readme | emphasis | yes |
| real/npm-tar-readme | emphasis | yes |
| real/npm-tiny-emitter-readme | bullet | yes |
| real/npm-toml-readme | headingStyle1, headingStyle2, setext | yes |
| real/npm-ts-node-readme | bullet | yes |
| real/npm-typeorm-cli-readme | eol | yes |
| real/npm-unified-readme | bullet | yes |
| real/npm-unzipper-readme | bullet, strong | yes |
| real/npm-uuid-readme | emphasis | yes |
| real/npm-uvu-readme | bullet, emphasis | yes |
| real/npm-webpack-readme | emphasis | yes |
| real/npm-winston-readme | bullet, emphasis | yes |
| real/npm-xml2js-readme | bullet, headingStyle1, headingStyle2, setext | yes |
| real/npm-xmldom-readme | bullet, emphasis, headingStyle1, headingStyle2, setext | yes |
| real/npm-yargs-readme | bullet | yes |
| real/npm-yup-readme | emphasis | yes |
| real/rust-lang-rfcs-text0001privatefieldsmd | bullet | yes |
| real/rust-lang-rfcs-text0086pluginregistrarmd | fence | yes |
| real/rust-lang-rfcs-text0494cstrandcvecstabilitymd | bullet | yes |
| real/rust-lang-rfcs-text0823hashsimplificationmd | bullet | yes |
| real/rust-lang-rfcs-text1270deprecationmd | bullet | yes |
| real/rust-lang-rfcs-text1560nameresolutionmd | bullet | yes |
| real/rust-lang-rfcs-text1845sharedfromslicemd | bullet | yes |
| real/rust-lang-rfcs-text2091inlinesemanticmd | ruleRepetition | yes |
| real/rust-lang-rfcs-text2957cargofeatures2md | bullet | yes |
| real/rust-lang-rfcs-text3119rustcrateownershipmd | emphasis | yes |
| real/rust-lang-rfcs-text3254typesteammd | bullet | yes |
| real/rust-lang-rfcs-text3392leadershipcouncilleadershipcouncilrfc | ruleRepetition | yes |
| real/rust-lang-rfcs-text3695cfgbooleanliteralsmd | emphasis | yes |
| real/rust-lang-rfcs-text3892complexnumbersmd | emphasis | yes |

Informational, per top-level block, forced re-serialization (hints on / hints off): byte-identical to `src` 94.7% / 93.9%; semantically-verified re-serialize (not `unverified`) 99.9% / 99.9% (n=31547 blocks).

## Run info

- Mode: full corpus
- Elapsed: 390.0s

