#!/bin/bash
# Usage: push-dev.sh off|on  pushes the dev checkout to prod Convex, with schema validation off or on.
R="${R:-$HOME/.os-rehearsal}"
unset CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
set -a; . "$R/prod-convex.env" || exit 1; set +a
[ -n "$CONVEX_SELF_HOSTED_URL" ] && [ -n "$CONVEX_SELF_HOSTED_ADMIN_KEY" ] || { echo "$R/prod-convex.env needs CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY"; exit 1; }
cd "$R/dev" || exit 1
if [ "$1" = off ]; then cp convex/schema.ts /tmp/dev-schema.bak; perl -0pi -e 's/\}\);\s*$/}, { schemaValidation: false });\n/' convex/schema.ts; fi
npx convex dev --once --typecheck disable --tail-logs disable 2>&1 | tail -${2:-8} | cut -c1-420
rc=${PIPESTATUS[0]}
if [ "$1" = off ]; then cp /tmp/dev-schema.bak convex/schema.ts; rm -f /tmp/dev-schema.bak; fi
echo "push $1 exit=$rc"; exit $rc
