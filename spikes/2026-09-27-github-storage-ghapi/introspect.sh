#!/usr/bin/env bash
# introspect.sh: read-only GraphQL schema checks for the ref-update mutations. No writes.
GATE=introspect
source "$(dirname "$0")/lib.sh"
for t in UpdateRefsInput RefUpdate UpdateRefInput CreateCommitOnBranchInput CommittableBranch; do
  gql_read 'query($n: String!) { __type(name: $n) { name description inputFields { name description type { name kind ofType { name kind ofType { name } } } } } }' \
    "$(jq -n -c --arg n "$t" '{n:$n}')"
  jq -c '.data.__type | {name, description, fields:[.inputFields[]? | {name, type:(.type.name // .type.ofType.name // .type.ofType.ofType.name), description}]}' "$BODY_FILE"
done
gql_read 'query { __schema { mutationType { fields { name description } } } }'
jq -c '.data.__schema.mutationType.fields[] | select(.name|test("[Rr]ef|[Cc]ommit")) | {name, description}' "$BODY_FILE"
