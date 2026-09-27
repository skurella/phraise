#!/usr/bin/env bash
# Gate D: race detection. A writer that expects an old head must fail cleanly when the head moved.
#   Branch spike-scratch/github-storage-d:
#     REST PATCH force=false with a commit whose parent is the stale head   -> expect 422
#     GraphQL createCommitOnBranch with a stale expectedHeadOid              -> expect error
#     GraphQL updateRefs with a stale beforeOid, even with force=true        -> expect error
#   Hidden draft ref refs/phraise-spike/drafts/race-test (parentless commits, as drafts are):
#     updateRefs create-if-absent, create again, CAS overwrite, stale CAS, REST non-force, delete
# Writes: about 15.
GATE=D
source "$(dirname "$0")/lib.sh"
BR="spike-scratch/github-storage-d"; REF="refs/heads/$BR"
DREF="refs/phraise-spike/drafts/race-test"
ZERO=0000000000000000000000000000000000000000
OUT="$EVIDENCE_DIR/gate-d.jsonl"; : > "$OUT"
rec() { # rec <case> <expected> ; uses STATUS and BODY_FILE of the last call
  jq -n -c --arg c "$1" --arg e "$2" --arg s "$STATUS" --arg ms "$DUR_MS" --slurpfile b "$BODY_FILE" \
    '{case:$c,expected:$e,status:($s|tonumber),ms:($ms|tonumber),response:$b[0]}' >> "$OUT"
  log "case $1: HTTP $STATUS $(head -c 300 "$BODY_FILE")"
}
gql_ok() { jq -e '(.errors // []) | length == 0' "$BODY_FILE" >/dev/null; }

[[ -z "$(ref_sha "$REF")" ]] || die "$REF exists; run cleanup.sh first"
[[ -z "$(ref_sha "$DREF")" ]] || die "$DREF exists; run cleanup.sh first"
H="$(ref_sha refs/heads/main)"
get "repos/$REPO/git/commits/$H"; expect 200; HT="$(jbody .tree.sha)"
ref_create "$REF" "$H"; expect 201

# Another writer moves the head: H -> A1.
tmpc="$(mktemp "$STATE_DIR/in.XXXXXX")"; echo "moved by the other writer" > "$tmpc"
gql_commit "$BR" "$H" "Spike 4: the other writer moves the head" "" "spike-4-scratch/race.md" "$tmpc"
A1="$(jbody '.data.createCommitOnBranch.commit.oid')"; [[ "$A1" =~ ^[0-9a-f]{40}$ ]] || die "setup commit failed"

# Our writer still believes the head is H.
S="$(commit_obj "Spike 4: stale writer's commit, parent is the old head" "$HT" "$H")"
ref_update "$REF" "$S" false; rec rest_patch_nonforce_stale "422 not a fast forward"
gql_commit "$BR" "$H" "Spike 4: stale GraphQL writer" "" "spike-4-scratch/race.md" "$tmpc"; rec gql_commit_stale_expectedHeadOid "error, head moved"
gql_update_ref "$REF" "$H" "$S" true; rec gql_updaterefs_stale_before_force "error, beforeOid mismatch"
[[ "$(ref_sha "$REF")" == "$A1" ]] || die "branch head changed; a stale write got through"
log "branch head still A1 = $A1"

# Hidden draft ref with parentless commits.
D1="$(commit_obj "draft 1" "$HT")"; D2="$(commit_obj "draft 2" "$HT")"; D3="$(commit_obj "draft 3" "$HT")"
gql_update_ref "$DREF" "$ZERO" "$D1" false; rec draft_create_if_absent "ok"; gql_ok || die "create failed"
gql_update_ref "$DREF" "$ZERO" "$D2" true;  rec draft_create_again "error, ref exists"
gql_update_ref "$DREF" "$D1" "$D2" true;    rec draft_cas_overwrite_parentless "ok"; gql_ok || die "CAS failed"
gql_update_ref "$DREF" "$D1" "$D3" true;    rec draft_cas_stale "error, beforeOid mismatch"
ref_update "$DREF" "$D3" false;             rec draft_rest_patch_nonforce_parentless "422 not a fast forward (measured: 200, see findings)"
cur="$(ref_sha "$DREF")"; log "draft ref now at $cur (D2=$D2, D3=$D3)"
gql_update_ref "$DREF" "$cur" "$ZERO" true; rec draft_cas_delete "ok"; gql_ok || die "delete failed"
get "repos/$REPO/git/ref/${DREF#refs/}"; rec draft_get_after_delete "404"
rm -f "$tmpc"
jq -c '{case,expected,status,ms,message:(.response.message // (.response.errors // [] | map(.message) | join("; ")) // null),
        data:(.response.data // null)}' "$OUT"
