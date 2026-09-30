#!/usr/bin/env bash
# Every OpenAlex API request carries OpenScholar's key, through openAlexUrl in
# lib/openalex/request-url.ts. Fails when code writes the API's URL itself instead.
set -u
cd "$(dirname "$0")/.."
hits=$(git grep -n -E "[\"'\`]https?://api\.openalex\.org" -- app components convex hooks lib scripts \
  ':!lib/openalex/request-url.ts' ':!convex/_generated' ':!*.test.*')
if [ -n "$hits" ]; then
  echo "$hits"
  echo "Build OpenAlex request URLs with openAlexUrl from lib/openalex/request-url.ts, which adds the key."
  exit 1
fi
echo "OpenAlex key: every request URL comes from openAlexUrl."
