#!/bin/bash
# Usage: push-dev.sh off|on  pushes the dev checkout to prod Convex, with schema validation off or on.
R="${R:-$HOME/.os-rehearsal}"
set -a; . "$R/prod-convex.env"; set +a
cd "$R/dev" || exit 1
if [ "$1" = off ]; then cp convex/schema.ts /tmp/dev-schema.bak; perl -0pi -e 's/\}\);\s*$/}, { schemaValidation: false });\n/' convex/schema.ts; fi
npx convex dev --once --typecheck disable --tail-logs disable 2>&1 | tail -${2:-8} | cut -c1-420
rc=${PIPESTATUS[0]}
if [ "$1" = off ]; then cp /tmp/dev-schema.bak convex/schema.ts; rm -f /tmp/dev-schema.bak; fi
echo "push $1 exit=$rc"; exit $rc
