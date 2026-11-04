#!/bin/bash
# Usage: push-dev.sh off|on  pushes the dev checkout to the spare deployment, with schema validation off or on.
cd "${R:-$HOME/.os-rehearsal}/dev" || exit 1
export CONVEX_DEPLOYMENT=dev:formal-rabbit-271 CONVEX_SELF_HOSTED_URL= CONVEX_SELF_HOSTED_ADMIN_KEY=
if [ "$1" = off ]; then cp convex/schema.ts /tmp/dev-schema.bak; perl -0pi -e 's/\}\);\s*$/}, { schemaValidation: false });\n/' convex/schema.ts; fi
npx convex dev --once --typecheck disable --tail-logs disable 2>&1 | tail -${2:-8} | cut -c1-420
rc=${PIPESTATUS[0]}
if [ "$1" = off ]; then cp /tmp/dev-schema.bak convex/schema.ts; rm -f /tmp/dev-schema.bak; fi
echo "push $1 exit=$rc"; exit $rc
