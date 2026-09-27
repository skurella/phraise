#!/usr/bin/env bash
# One-off continuation of the first gate D run (2026-09-27 04:18), which stopped at the
# assertion "draft ref not at D2" because the REST PATCH with force=false moved a hidden ref
# to a parentless commit. Finishes that run's last two cases. Kept for the record.
GATE=D
source "$(dirname "$0")/lib.sh"
DREF="refs/phraise-spike/drafts/race-test"
ZERO=0000000000000000000000000000000000000000
OUT="$EVIDENCE_DIR/gate-d.jsonl"
rec() {
  jq -n -c --arg c "$1" --arg e "$2" --arg s "$STATUS" --arg ms "$DUR_MS" --slurpfile b "$BODY_FILE" \
    '{case:$c,expected:$e,status:($s|tonumber),ms:($ms|tonumber),response:$b[0]}' >> "$OUT"
}
cur="$(ref_sha "$DREF")"; log "draft ref at $cur"
gql_update_ref "$DREF" "$cur" "$ZERO" true; rec draft_cas_delete "ok"
get "repos/$REPO/git/ref/${DREF#refs/}"; rec draft_get_after_delete "404"
tail -2 "$OUT" | jq -c '{case,status,data:.response.data,message:.response.message}'
