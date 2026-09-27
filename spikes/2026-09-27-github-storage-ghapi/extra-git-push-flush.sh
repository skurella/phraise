#!/usr/bin/env bash
# Extra (beyond gates A-H): a draft flush as ONE git push over the owner's SSH remote instead of
# 3-5 REST calls, with compare-and-swap through --force-with-lease on a hidden ref.
#   1. create-if-absent (lease: ref must not exist), small draft
#   2. CAS overwrite with a parentless commit holding 1 MB Markdown + 1 MB binary
#   3. stale CAS (lease on the old value)            -> expect rejection
#   4. CAS delete
# Pushes: 4 attempts, each counted as a write with the same spacing as the API writes.
GATE=X-push
source "$(dirname "$0")/lib.sh"
REF="refs/phraise-spike/drafts/git-push-test"
URL="git@github.com:$REPO.git"
OUT="$EVIDENCE_DIR/extra-git-push.jsonl"; : > "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
if [[ -n "$(ref_sha "$REF")" ]]; then ref_delete "$REF"; expect 204; log "deleted leftover $REF"; fi
# Note: a "+" on the refspec overrides --force-with-lease; run 1 used "+" and its stale push succeeded.

external_write() {
  check_stop; ref_allowed "$1" || die "push to $1 not allowed"
  local n; n="$(writes_used)"; (( n < MAX_WRITES )) || die "write cap reached"
  local last gap; last="$(cat "$STATE_DIR/last_write")"
  gap="$(perl -e "printf '%.3f', $MIN_GAP - ($(now) - $last)")"
  if perl -e "exit !($gap > 0)"; then sleep "$gap"; fi
  echo $((n + 1)) > "$STATE_DIR/writes"
}
G() { git -C "$WORK/r" "$@"; }
git init -q "$WORK/r"; G config user.name "Phraise spike 4"; G config user.email "spike4@example.invalid"
orphan() { # orphan <label> <md bytes> <bin bytes> -> commit sha, parentless
  { echo "# draft $1"; head -c "$2" /dev/urandom | base64; } > "$WORK/r/draft.md"
  head -c "$3" /dev/urandom > "$WORK/r/draft.crdt"
  G add draft.md draft.crdt
  local tree; tree="$(G write-tree)"
  G commit-tree "$tree" -m "draft $1"
}
push() { # push <case> <expected> <lease> <src:dst>
  external_write "$REF"
  local t0 t1 rc=0 out; t0="$(now)"
  out="$(G push --porcelain "$URL" "--force-with-lease=$REF:$3" "$4" 2>&1)" || rc=$?
  t1="$(now)"; echo "$t1" > "$STATE_DIR/last_write"
  jq -n -c --arg c "$1" --arg e "$2" --argjson rc "$rc" --arg ms "$(perl -e "printf '%d', ($t1-$t0)*1000")" \
    --arg out "$(grep -E '^[!=+* -]	|^Done|^To |rejected|stale' <<<"$out" | head -5)" \
    '{case:$c,expected:$e,exit:$rc,ms:($ms|tonumber),porcelain:$out}' | tee -a "$OUT"
  log "push $1 -> exit $rc (writes $(writes_used))"
}

C1="$(orphan 1 3000 4096)"
push create_if_absent "ok" "" "$C1:$REF"
C2="$(orphan 2 780000 1048576)"
push cas_overwrite_1MB_plus_1MB "ok" "$C1" "$C2:$REF"
C3="$(orphan 3 3000 4096)"
push stale_lease "rejected (stale info)" "$C1" "$C3:$REF"
[[ "$(ref_sha "$REF")" == "$C2" ]] || die "ref not at C2 after stale push"
push cas_delete "ok" "$C2" ":$REF"
get "repos/$REPO/git/ref/${REF#refs/}"; log "after delete: HTTP $STATUS"
