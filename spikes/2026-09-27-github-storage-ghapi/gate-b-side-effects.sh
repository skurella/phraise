#!/usr/bin/env bash
# Gate B: what does a hidden-ref write trigger? Read-only. Takes a labelled snapshot of
# everything observable with the owner's token and stores it under evidence/gate-b-<label>.json.
# Run with label "before" ahead of gate A, "after" right after it, and "late" some time later
# (the Events API lags 30 s to 6 h). Compare with: ./gate-b-side-effects.sh compare
GATE=B
source "$(dirname "$0")/lib.sh"
label="${1:-snapshot}"

if [[ "$label" == compare ]]; then
  for f in "$EVIDENCE_DIR"/gate-b-*.json; do
    jq -c '{label,events_total,events_mentioning_spike,activity_mentioning_spike,actions_runs_total,
            notifications_total,notifications_repo,hooks,rulesets,workflows}' "$f"
  done
  exit 0
fi

get "repos/$REPO/events?per_page=100"; expect 200
events="$(jq -c '[.[] | {id,type,created_at,ref:(.payload.ref // null),ref_type:(.payload.ref_type // null)}]' "$BODY_FILE")"
events_spike="$(jq -c '[.[] | select((.payload.ref // "") | test("phraise-spike|spike-scratch")) | {id,type,created_at,ref:.payload.ref}]' "$BODY_FILE")"

get "repos/$REPO/activity?per_page=100"; activity_status="$STATUS"
activity_spike="$(jq -c 'if type=="array" then [.[] | select(.ref | test("phraise-spike|spike-scratch")) | {id,ref,activity_type,timestamp}] else . end' "$BODY_FILE")"
activity_refs="$(jq -c 'if type=="array" then [.[] | .ref] | unique else [] end' "$BODY_FILE")"

get "repos/$REPO/actions/runs?per_page=20"; runs_status="$STATUS"
runs="$(jq -c '{total:.total_count, recent:[.workflow_runs[]? | {event,head_branch,created_at}]}' "$BODY_FILE")"
get "repos/$REPO/actions/workflows"; workflows="$(jq -c '.total_count' "$BODY_FILE")"

get "notifications?all=true&per_page=50"; notif_status="$STATUS"
notif_total="$(jq 'if type=="array" then length else -1 end' "$BODY_FILE")"
notif_repo="$(jq -c --arg r "$REPO" 'if type=="array" then [.[] | select(.repository.full_name==$r) | {reason,updated_at,subject:.subject.type}] else [] end' "$BODY_FILE")"

get "repos/$REPO/hooks"; hooks="$(jq -c 'if type=="array" then length else . end' "$BODY_FILE")"
get "repos/$REPO/rulesets"; rulesets="$(jq -c 'if type=="array" then [.[] | {name,target,enforcement}] else . end' "$BODY_FILE")"
get "repos/$REPO/rules/branches/main"; main_rules="$(jq -c 'if type=="array" then [.[].type] else . end' "$BODY_FILE")"

jq -n --arg label "$label" --arg at "$(date -u +%FT%TZ)" --argjson events "$events" \
  --argjson events_spike "$events_spike" --arg activity_status "$activity_status" \
  --argjson activity_spike "$activity_spike" --argjson activity_refs "$activity_refs" \
  --arg runs_status "$runs_status" --argjson runs "$runs" --argjson workflows "$workflows" \
  --arg notif_status "$notif_status" --argjson notif_total "$notif_total" --argjson notif_repo "$notif_repo" \
  --argjson hooks "$hooks" --argjson rulesets "$rulesets" --argjson main_rules "$main_rules" \
  '{label:$label,at:$at,events_total:($events|length),events_latest:($events[:5]),
    events_mentioning_spike:$events_spike,activity_status:$activity_status,
    activity_mentioning_spike:$activity_spike,activity_refs:$activity_refs,
    actions_runs_status:$runs_status,actions_runs_total:$runs.total,actions_recent:$runs.recent,
    workflows:$workflows,notifications_status:$notif_status,notifications_total:$notif_total,
    notifications_repo:$notif_repo,hooks:$hooks,rulesets:$rulesets,main_rules:$main_rules}' \
  | tee "$EVIDENCE_DIR/gate-b-$label.json" | jq -c '{label,events_total,events_mentioning_spike,activity_mentioning_spike,actions_runs_total,notifications_total,hooks,rulesets,workflows}'
