#!/usr/bin/env bash
# smoke.sh: read-only checks that the wrapper, ETags and GraphQL reads work. No writes.
GATE=smoke
source "$(dirname "$0")/lib.sh"
get "repos/$REPO/git/ref/heads/main"; expect 200
e="$(header Etag)"; echo "etag=$e"
get "repos/$REPO/git/ref/heads/main" "If-None-Match: $e"; echo "conditional status=$STATUS"
gql_read 'query { rateLimit { cost remaining used limit resetAt } viewer { login } }'; body; echo
