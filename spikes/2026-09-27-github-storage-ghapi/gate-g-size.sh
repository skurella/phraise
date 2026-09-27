#!/usr/bin/env bash
# Gate G: time a draft flush with a 1 MB Markdown blob and a 1 MB binary blob.
#   full flush (blob, blob, tree, commit, ref) x TRIALS, inline-tree flush (tree, commit, ref) x TRIALS,
#   then read the Markdown blob back once, then delete the ref.
# Content is incompressible (random), which is the worst case for transfer.
# Writes: 5 + 5*(TRIALS-1) + 3*TRIALS + 1. Default TRIALS=3 -> 25.
GATE=G
source "$(dirname "$0")/lib.sh"
TRIALS="${TRIALS:-3}"
REF="refs/phraise-spike/drafts/main/size-test"
OUT="$EVIDENCE_DIR/gate-g.jsonl"; : > "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
if [[ -n "$(ref_sha "$REF")" ]]; then  # left over from an aborted run: this gate's own ref
  ref_delete "$REF"; expect 204; log "deleted leftover $REF"
fi

make_content() {
  { echo "# Large draft $1"; head -c 780000 /dev/urandom | base64 | fold -w 76 | sed 's/^/Line /'; } \
    | head -c 1048576 > "$WORK/draft.md" || true  # head closes the pipe early (SIGPIPE)
  head -c 1048576 /dev/urandom > "$WORK/draft.crdt"
}
step() { jq -n -c --arg f "$1" --arg v "$2" --arg s "$3" --argjson ms "$DUR_MS" '{flush:($f|tonumber),variant:$v,step:$s,ms:$ms}' >> "$OUT"; }

exists=0
flush_full() {
  make_content "$1"; local t0 b1 b2 t c
  t0="$(now)"
  b1="$(blob_from_file "$WORK/draft.md")"
  b2="$(blob_from_file "$WORK/draft.crdt")"
  t="$(tree_two "$b1" "$b2")"
  c="$(commit_obj "size test flush $1" "$t")"
  if [[ $exists == 0 ]]; then ref_create "$REF" "$c"; expect 201; exists=1; else ref_update "$REF" "$c" true; expect 200; fi
  jq -n -c --arg f "$1" --arg ms "$(perl -e "printf '%d', ($(now) - $t0)*1000")" --arg md "$(wc -c < "$WORK/draft.md" | tr -d ' ')" \
    '{flush:($f|tonumber),variant:"full",total_wall_ms:($ms|tonumber),md_bytes:($md|tonumber),bin_bytes:1048576}' >> "$OUT"
  mdblob="$b1"
}
flush_inline() {
  make_content "$1"; local t0 f t c
  t0="$(now)"
  f="$(jfile --rawfile md "$WORK/draft.md" --rawfile b64 <(base64 < "$WORK/draft.crdt" | tr -d '\n') \
    '{tree:[{path:"draft.md",mode:"100644",type:"blob",content:$md},{path:"draft.crdt.b64",mode:"100644",type:"blob",content:$b64}]}')"
  local req_bytes; req_bytes="$(wc -c < "$f" | tr -d ' ')"
  call POST "repos/$REPO/git/trees" "$f"; expect 201; t="$(jbody .sha)"; rm -f "$f"
  c="$(commit_obj "size test inline flush $1" "$t")"
  ref_update "$REF" "$c" true; expect 200
  jq -n -c --arg f "$1" --arg ms "$(perl -e "printf '%d', ($(now) - $t0)*1000")" --arg rb "$req_bytes" \
    '{flush:($f|tonumber),variant:"inline",total_wall_ms:($ms|tonumber),tree_request_bytes:($rb|tonumber)}' >> "$OUT"
}

for i in $(seq 1 "$TRIALS"); do flush_full "$i"; done
for i in $(seq 1 "$TRIALS"); do flush_inline "$((TRIALS + i))"; done
get "repos/$REPO/git/blobs/$mdblob"; expect 200
jq -n -c --argjson ms "$DUR_MS" --arg b "$(wc -c < "$BODY_FILE" | tr -d ' ')" '{step:"read_1MB_md_blob",ms:$ms,response_bytes:($b|tonumber)}' >> "$OUT"
ref_delete "$REF"; expect 204

# Per-call timings for this gate come from calls.jsonl.
jq -s -c '[.[] | select(.gate=="G" and .write)] | group_by(.method + " " + (.path|sub("/refs/.*";"/refs/X")))
  | map({call:(.[0].method + " " + (.[0].path|sub("repos/skurella/phraise/";"")|sub("/refs/.*";"/refs/X"))), n:length,
         ms:(map(.ms)), avg_ms:(map(.ms)|add/length|floor)})' "$EVIDENCE_DIR/calls.jsonl" | tee "$EVIDENCE_DIR/gate-g-calls.json"
cat "$OUT"
