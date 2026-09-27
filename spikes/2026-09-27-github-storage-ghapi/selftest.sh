#!/usr/bin/env bash
# selftest.sh: offline test of the safety allow-list in lib.sh. Makes no network calls.
set -uo pipefail
export PHRAISE_SPIKE_STATE="$(mktemp -d)"
export PHRAISE_SPIKE_EVIDENCE="$PHRAISE_SPIKE_STATE/evidence"
source "$(dirname "$0")/lib.sh"
set +e
pass=0; fail=0
B="repos/skurella/phraise/git"

check() { # check <expect ok|deny> <method> <path> [json body]
  local want="$1" m="$2" p="$3" in=""
  if [[ $# -ge 4 ]]; then in="$PHRAISE_SPIKE_STATE/body.json"; printf '%s' "$4" > "$in"; fi
  ( validate_write "$m" "$p" "$in" ) 2>/dev/null
  local got=$([[ $? == 0 ]] && echo ok || echo deny)
  if [[ "$got" == "$want" ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $want $m $p $in"; fi
}

check ok   POST "$B/blobs"
check ok   POST "$B/trees"
check ok   POST "$B/commits"
check ok   POST "$B/refs" '{"ref":"refs/phraise-spike/drafts/x","sha":"a"}'
check ok   POST "$B/refs" '{"ref":"refs/heads/spike-scratch/github-storage-c","sha":"a"}'
check deny POST "$B/refs" '{"ref":"refs/heads/main","sha":"a"}'
check deny POST "$B/refs" '{"ref":"refs/heads/spike-scratch/other","sha":"a"}'
check deny POST "$B/refs" '{"ref":"refs/heads/spike/2026-09-27-github-storage","sha":"a"}'
check deny POST "$B/refs" '{"ref":"refs/phraise-spike/../heads/main","sha":"a"}'
check deny POST "$B/refs" '{"ref":"refs/phraise-spike/","sha":"a"}'
check deny POST "$B/refs" '{"ref":"refs/tags/x","sha":"a"}'
check ok   PATCH "$B/refs/phraise-spike/drafts/x"
check ok   PATCH "$B/refs/heads/spike-scratch/github-storage-c"
check deny PATCH "$B/refs/heads/main"
check deny PATCH "$B/refs/heads/spike-scratch/github-storage"
check ok   DELETE "$B/refs/phraise-spike/retention-probe"
check deny DELETE "$B/refs/heads/main"
check deny DELETE "repos/skurella/phraise"
check deny PUT "repos/skurella/phraise/contents/README.md"
check deny POST "repos/skurella/phraise/hooks"
check deny POST "repos/other/repo/git/blobs"
check deny PATCH "repos/skurella/phraise"
Q="$GQL_COMMIT"
mk() { jq -n -c --arg q "$Q" --arg r "$1" --arg b "$2" '{query:$q,variables:{input:{branch:{repositoryNameWithOwner:$r,branchName:$b}}}}'; }
check ok   POST graphql "$(mk skurella/phraise spike-scratch/github-storage-c)"
check deny POST graphql "$(mk skurella/phraise main)"
check deny POST graphql "$(mk other/repo spike-scratch/github-storage-c)"
check deny POST graphql '{"query":"mutation { deleteRef(input:{refId:\"x\"}) { clientMutationId } }"}'

U="$GQL_UPDATE_REFS"
mu() { jq -n -c --arg q "$U" --arg id "$1" --arg n "$2" '{query:$q,variables:{input:{repositoryId:$id,refUpdates:[{name:$n,beforeOid:"a",afterOid:"b"}]}}}'; }
check ok   POST graphql "$(mu R_kgDOUtgoIw refs/phraise-spike/drafts/d)"
check deny POST graphql "$(mu R_kgDOUtgoIw refs/heads/main)"
check deny POST graphql "$(mu R_other refs/phraise-spike/drafts/d)"
check deny POST graphql "$(jq -n -c --arg q "$U" '{query:$q,variables:{input:{repositoryId:"R_kgDOUtgoIw",refUpdates:[{name:"refs/phraise-spike/x"},{name:"refs/heads/main"}]}}}')"
check deny POST graphql "$(jq -n -c --arg q "$Q deleteRef" '{query:$q,variables:{input:{branch:{repositoryNameWithOwner:"skurella/phraise",branchName:"spike-scratch/github-storage-c"}}}}')"

echo "selftest: $pass passed, $fail failed"
rm -rf "$PHRAISE_SPIKE_STATE"
[[ $fail == 0 ]]
