#!/usr/bin/env bash
# Every OpenAlex API request carries OpenScholar's key: through openAlexUrl in
# lib/openalex/request-url.ts, worksUrl in lib/openalex/works-url.ts, or the SDK client
# in lib/openalex.ts. Fails when code builds an OpenAlex request any other way.
set -u
cd "$(dirname "$0")/.."
sources=(app components convex hooks lib scripts ':!convex/_generated' ':!*.test.*' ':!scripts/check-openalex-key.sh')
failed=0
fail() {
  if [ -n "$1" ]; then echo "$1"; echo "$2"; echo; failed=1; fi
}
fail "$(git grep -n -E "[\"'\`]https?://api\.openalex\.org" -- "${sources[@]}" ':!lib/openalex/request-url.ts')" \
  "Build OpenAlex request URLs with openAlexUrl from lib/openalex/request-url.ts, which adds the key."
fail "$(git grep -n -w "buildUrl" -- "${sources[@]}" ':!lib/openalex/works-url.ts')" \
  "Build works search URLs with worksUrl from lib/openalex/works-url.ts; the SDK's buildUrl adds no key and encodes nothing."
fail "$(git grep -n -w "new OpenAlexClient" -- "${sources[@]}" ':!lib/openalex.ts')" \
  "Use the client from lib/openalex.ts, which encodes search text so the key survives."
[ "$failed" = 0 ] && echo "OpenAlex key: every request is built with the key."
exit "$failed"
