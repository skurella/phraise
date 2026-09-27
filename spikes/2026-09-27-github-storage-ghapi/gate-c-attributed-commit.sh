#!/usr/bin/env bash
# Gate C: attributed commit with two Co-authored-by trailers, REST Git Data route vs GraphQL
# createCommitOnBranch, on scratch branch spike-scratch/github-storage-c (created from main).
# Writes: 1 (branch) + 3 (REST: inline tree, commit, ref PATCH) + 1 (GraphQL) = 5.
GATE=C
source "$(dirname "$0")/lib.sh"
BR="spike-scratch/github-storage-c"; REF="refs/heads/$BR"
OUT="$EVIDENCE_DIR/gate-c.json"
TRAILERS="Co-authored-by: The Octocat <583231+octocat@users.noreply.github.com>
Co-authored-by: Phraise Example <phraise-example@example.com>"

[[ -z "$(ref_sha "$REF")" ]] || die "$REF exists; run cleanup.sh first"
H="$(ref_sha refs/heads/main)"; [[ -n "$H" ]] || die "cannot read main"
get "repos/$REPO/git/commits/$H"; expect 200; HT="$(jbody .tree.sha)"
ref_create "$REF" "$H"; expect 201

# REST Git Data route: tree (inline content on top of base_tree) + commit + ref update.
w0="$(writes_used)"; t0="$(now)"
f="$(jfile --arg bt "$HT" --arg c "Written through the REST Git Data API by spike 4 at $(date -u +%FT%TZ).
" '{base_tree:$bt,tree:[{path:"spike-4-scratch/rest.md",mode:"100644",type:"blob",content:$c}]}')"
call POST "repos/$REPO/git/trees" "$f"; expect 201; T="$(jbody .sha)"; rm -f "$f"
R="$(commit_obj "Spike 4: commit through REST Git Data API

Body line for the commit message.

$TRAILERS" "$T" "$H")"
ref_update "$REF" "$R" false; expect 200
rest_writes=$(( $(writes_used) - w0 )); rest_ms="$(perl -e "printf '%d', ($(now) - $t0)*1000")"

# GraphQL route: one mutation, expectedHeadOid = R.
w0="$(writes_used)"; t0="$(now)"
tmpc="$(mktemp "$STATE_DIR/in.XXXXXX")"
echo "Written through GraphQL createCommitOnBranch by spike 4 at $(date -u +%FT%TZ)." > "$tmpc"
gql_commit "$BR" "$R" "Spike 4: commit through GraphQL createCommitOnBranch" "Body line for the commit message.

$TRAILERS" "spike-4-scratch/graphql.md" "$tmpc"; rm -f "$tmpc"
expect 200
G="$(jbody '.data.createCommitOnBranch.commit.oid')"
[[ "$G" =~ ^[0-9a-f]{40}$ ]] || die "GraphQL commit failed: $(body)"
gql_writes=$(( $(writes_used) - w0 )); gql_ms="$(perl -e "printf '%d', ($(now) - $t0)*1000")"

# Inspect both commits: REST view and GraphQL view (authors list parses Co-authored-by).
inspect() {
  get "repos/$REPO/commits/$1"; expect 200
  local rest; rest="$(jq -c '{author:.commit.author, committer:.commit.committer,
    author_login:.author.login, committer_login:.committer.login, verification:.commit.verification}' "$BODY_FILE")"
  gql_read 'query($o: GitObjectID!) { repository(owner: "skurella", name: "phraise") { object(oid: $o) { ... on Commit {
      oid authors(first: 5) { nodes { name email user { login } } }
      committer { name email user { login } } signature { isValid state wasSignedByGitHub signer { login } } } } } }' \
    "$(jq -n -c --arg o "$1" '{o:$o}')"
  local gql; gql="$(jq -c '.data.repository.object | {authors:[.authors.nodes[] | {name,email,login:(.user.login // null)}], committer, signature}' "$BODY_FILE")"
  jq -n -c --arg sha "$1" --argjson rest "$rest" --argjson gql "$gql" '{sha:$sha,rest:$rest,graphql:$gql}'
}
sleep 2
rest_view="$(inspect "$R")"; gql_view="$(inspect "$G")"

# How the web UI renders co-authors: anonymous fetch of the public commit page (read-only).
render() {
  local html; html="$(curl -s "https://github.com/$REPO/commit/$1")"
  jq -n -c --arg octo "$(grep -o 'octocat' <<<"$html" | wc -l | tr -d ' ')" \
    --arg ex "$(grep -o 'Phraise Example' <<<"$html" | wc -l | tr -d ' ')" \
    --arg coauth "$(grep -o -i 'co-authored' <<<"$html" | wc -l | tr -d ' ')" \
    --arg verified "$(grep -o -i '"verified"[^,}]*' <<<"$html" | head -1)" \
    '{octocat_mentions:($octo|tonumber),example_mentions:($ex|tonumber),coauthored_mentions:($coauth|tonumber),verified_hint:$verified}'
}
jq -n --arg branch "$BR" --arg base "$H" --argjson rest_writes "$rest_writes" --argjson rest_ms "$rest_ms" \
  --argjson gql_writes "$gql_writes" --argjson gql_ms "$gql_ms" --argjson rv "$rest_view" --argjson gv "$gql_view" \
  --argjson rr "$(render "$R")" --argjson gr "$(render "$G")" \
  '{branch:$branch,base:$base,rest:{writes:$rest_writes,ms:$rest_ms,view:$rv,html:$rr},
    graphql:{writes:$gql_writes,ms:$gql_ms,view:$gv,html:$gr}}' | tee "$OUT"
