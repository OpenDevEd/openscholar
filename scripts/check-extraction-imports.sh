#!/usr/bin/env bash
# Only convex/extraction imports the files under convex/extraction/mutations and
# convex/extraction/queries. Everything else reaches them through the generated api.
set -u
cd "$(dirname "$0")/.."
found="$(git grep -n -E "[\"'](@/|(\.\./)+)convex/extraction/(mutations|queries)/" -- \
  app components convex hooks lib i18n messages scripts tests ':!convex/extraction' ':!convex/_generated')"
if [ -n "$found" ]; then
  echo "$found"
  echo "Reach extraction mutations and queries through api.extraction, not by importing their files."
  exit 1
fi
echo "Extraction imports: only convex/extraction imports its mutations and queries."
