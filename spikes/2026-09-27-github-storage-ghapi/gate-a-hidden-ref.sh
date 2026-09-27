#!/usr/bin/env bash
# Gate A: hidden draft ref lifecycle.
#   1. create refs/phraise-spike/drafts/main/<path-hash> -> commit{draft.md, draft.crdt}
#   2. overwrite it N times (full flush: blob, blob, tree, commit, PATCH force) = 5 writes
#   3. overwrite M times with the inline-tree flush (tree with inline contents, commit, PATCH) = 3 writes
#   4. show: absent from branches API, absent from a default clone, advertised by ls-remote,
#      fetched by an explicit refspec with identical content
#   5. read back through the API, delete, confirm 404 and whether objects stay readable by SHA
# Writes: 5 + 5*N + 3*M + 1. Defaults N=10, M=3 -> 65.
GATE=A
source "$(dirname "$0")/lib.sh"
N="${N:-10}"; M="${M:-3}"
DOC_PATH="docs/example.md"
HASH="$(printf '%s' "$DOC_PATH" | shasum -a 1 | cut -c1-16)"
REF="refs/phraise-spike/drafts/main/$HASH"
OUT="$EVIDENCE_DIR/gate-a.jsonl"; : > "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

[[ -z "$(ref_sha "$REF")" ]] || die "$REF already exists; run cleanup.sh first"

make_content() { # make_content <i>: writes $WORK/draft.md and $WORK/draft.crdt
  { echo "# Example draft"; echo; echo "Flush $1 at $(date -u +%FT%TZ)."; echo
    for k in $(seq 1 40); do echo "Paragraph $k of flush $1: the quick brown fox jumps over the lazy dog."; done
  } > "$WORK/draft.md"
  head -c 4096 /dev/urandom > "$WORK/draft.crdt"
}

record() { # record <i> <variant> <writes> <ms> <commit>
  jq -n -c --argjson i "$1" --arg v "$2" --argjson w "$3" --argjson ms "$4" --arg c "$5" \
    '{flush:$i,variant:$v,writes:$w,ms:$ms,commit:$c}' >> "$OUT"
}

full_flush() { # full_flush <i> -> commit sha
  make_content "$1"
  local b1 b2 t
  b1="$(blob_from_file "$WORK/draft.md")"; b2="$(blob_from_file "$WORK/draft.crdt")"
  t="$(tree_two "$b1" "$b2")"
  commit_obj "phraise draft flush $1 of $DOC_PATH on main" "$t"
}

inline_flush() { # inline_flush <i> -> commit sha. Binary goes in as base64 text.
  make_content "$1"
  local f t
  f="$(jfile --rawfile md "$WORK/draft.md" --rawfile b64 <(base64 < "$WORK/draft.crdt" | tr -d '\n') \
    '{tree:[{path:"draft.md",mode:"100644",type:"blob",content:$md},
            {path:"draft.crdt.b64",mode:"100644",type:"blob",content:$b64}]}')"
  call POST "repos/$REPO/git/trees" "$f"; expect 201; t="$(jbody .sha)"; rm -f "$f"
  commit_obj "phraise draft flush $1 of $DOC_PATH on main (inline tree)" "$t"
}

# 1. create
w0="$(writes_used)"; t0="$(now)"
c="$(full_flush 0)"; ref_create "$REF" "$c"; expect 201
record 0 create $(( $(writes_used) - w0 )) "$(perl -e "printf '%d', ($(now) - $t0)*1000")" "$c"
[[ "$(ref_sha "$REF")" == "$c" ]] || die "read-back mismatch after create"

# 2. full overwrites
for i in $(seq 1 "$N"); do
  w0="$(writes_used)"; t0="$(now)"
  c="$(full_flush "$i")"; ref_update "$REF" "$c" true; expect 200
  record "$i" full $(( $(writes_used) - w0 )) "$(perl -e "printf '%d', ($(now) - $t0)*1000")" "$c"
  [[ "$(ref_sha "$REF")" == "$c" ]] || die "read-back mismatch after flush $i"
done

# 3. inline-tree overwrites
for j in $(seq 1 "$M"); do
  i=$((N + j)); w0="$(writes_used)"; t0="$(now)"
  c="$(inline_flush "$i")"; ref_update "$REF" "$c" true; expect 200
  record "$i" inline $(( $(writes_used) - w0 )) "$(perl -e "printf '%d', ($(now) - $t0)*1000")" "$c"
  [[ "$(ref_sha "$REF")" == "$c" ]] || die "read-back mismatch after inline flush $i"
done
LAST="$c"; cp "$WORK/draft.md" "$WORK/last.md"

# 4a. branches API and matching-refs
get "repos/$REPO/branches?per_page=100"; expect 200
in_branches="$(jq --arg h "$HASH" '[.[].name | select(test($h) or test("phraise-spike"))] | length' "$BODY_FILE")"
get "repos/$REPO/git/matching-refs/phraise-spike/"; expect 200
matching="$(jq -c '[.[].ref]' "$BODY_FILE")"

# 4b. default clone, ls-remote, explicit refspec fetch (anonymous https, public repo)
URL="https://github.com/$REPO.git"
git clone -q --no-checkout "$URL" "$WORK/clone"
clone_refs="$(git -C "$WORK/clone" for-each-ref --format='%(refname)' | grep -c phraise-spike || true)"
clone_has_obj="$(git -C "$WORK/clone" cat-file -e "$LAST" 2>/dev/null && echo yes || echo no)"
lsremote="$(git ls-remote "$URL" | grep -c "$REF" || true)"
git -C "$WORK/clone" fetch -q origin "$REF:refs/draft-fetched"
fetched_sha="$(git -C "$WORK/clone" rev-parse refs/draft-fetched)"
git -C "$WORK/clone" show "refs/draft-fetched:draft.md" > "$WORK/fetched.md"
fetch_same="$(cmp -s "$WORK/fetched.md" "$WORK/last.md" && echo yes || echo no)"

# 5. API read-back, delete, confirm
get "repos/$REPO/git/commits/$LAST"; expect 200; tree="$(jbody .tree.sha)"
get "repos/$REPO/git/trees/$tree"; expect 200
mdsha="$(jq -r '.tree[] | select(.path=="draft.md") | .sha' "$BODY_FILE")"
get "repos/$REPO/git/blobs/$mdsha"; expect 200
jbody .content | base64 -d > "$WORK/api.md"
api_same="$(cmp -s "$WORK/api.md" "$WORK/last.md" && echo yes || echo no)"
ref_delete "$REF"; del_status="$STATUS"
get "repos/$REPO/git/ref/${REF#refs/}"; after_delete_ref="$STATUS"
get "repos/$REPO/git/commits/$LAST"; obj_after_delete="$STATUS"
lsremote_after="$(git ls-remote "$URL" | grep -c "$REF" || true)"

jq -n --arg ref "$REF" --arg last "$LAST" --argjson in_branches "$in_branches" \
  --argjson matching "$matching" --arg clone_refs "$clone_refs" --arg clone_has_obj "$clone_has_obj" \
  --arg lsremote "$lsremote" --arg fetched_sha "$fetched_sha" --arg fetch_same "$fetch_same" \
  --arg api_same "$api_same" --arg del_status "$del_status" --arg after_delete_ref "$after_delete_ref" \
  --arg obj_after_delete "$obj_after_delete" --arg lsremote_after "$lsremote_after" \
  '{ref:$ref,last_commit:$last,branches_api_matches:$in_branches,matching_refs:$matching,
    default_clone_refs_matching:$clone_refs,default_clone_has_draft_commit:$clone_has_obj,
    ls_remote_advertises_ref:$lsremote,refspec_fetch_sha:$fetched_sha,refspec_fetch_content_matches:$fetch_same,
    api_readback_matches:$api_same,delete_status:$del_status,ref_get_after_delete:$after_delete_ref,
    commit_get_by_sha_after_delete:$obj_after_delete,ls_remote_after_delete:$lsremote_after}' \
  | tee "$EVIDENCE_DIR/gate-a-summary.json"
