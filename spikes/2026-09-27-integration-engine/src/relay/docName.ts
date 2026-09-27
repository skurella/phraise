// New for this spike (brief 04, src/relay/). Document naming (plan section
// 6): `<branch>:g<generation>:<path>`. `docId` (stable across generations;
// the input to `engine.seedFromCommit`'s deterministic seed-peer hash) is
// `<branch>:<path>` -- generation is threaded through as its own component,
// per plan section 4's `hash32(docId, commit, generation)`.
export interface DocNameParts {
  branch: string;
  path: string;
  generation: number;
}

// Greedy `.*` for `branch` finds the LAST `:g<digits>:` in the name, so an
// ordinary branch/path containing a stray `:g123:` substring would be
// misparsed -- accepted as a known limitation for this spike (branch names
// and Markdown paths in every test/gate are plain and never collide with
// this pattern).
const DOC_NAME_RE = /^(.*):g(\d+):(.*)$/;

export function makeDocName(branch: string, path: string, generation: number): string {
  return `${branch}:g${generation}:${path}`;
}

export function parseDocName(name: string): DocNameParts | null {
  const m = DOC_NAME_RE.exec(name);
  if (!m) return null;
  return { branch: m[1], generation: Number(m[2]), path: m[3] };
}

/** Stable document identity across generations (plan section 4's `phraise.docId`, and the input to every seed/rebase peer hash). */
export function docId(branch: string, path: string): string {
  return `${branch}:${path}`;
}
