#!/bin/bash
# Rehearses the upgrade on the spare deployment from a fresh copy of live. See README.md.
# Needs checkouts of main and dev at $R/main and $R/dev, with no .env.local.
export CONVEX_DEPLOYMENT=dev:formal-rabbit-271 CONVEX_SELF_HOSTED_URL= CONVEX_SELF_HOSTED_ADMIN_KEY=
R="${R:-$HOME/.os-rehearsal}"; t0=$(date +%s); stamp(){ echo "[$(( $(date +%s)-t0 )) s] $*"; }
HERE="$(cd "$(dirname "$0")" && pwd)"
cd $R/main || exit 1
cp convex/schema.ts /tmp/m.bak; perl -0pi -e 's/\}\);\s*$/}, { schemaValidation: false });\n/' convex/schema.ts
npx convex dev --once --typecheck disable --tail-logs disable 2>&1 | tail -1 | cut -c1-200
rm -f $R/prod-export.zip; npx convex export --prod --include-file-storage --path $R/prod-export.zip 2>&1 | tail -1 | cut -c1-120; stamp "exported live"
npx convex import --replace-all --yes $R/prod-export.zip 2>&1 | tail -1 | cut -c1-200; stamp "imported"
cp /tmp/m.bak convex/schema.ts; rm /tmp/m.bak
npx convex dev --once --typecheck disable --tail-logs disable 2>&1 | tail -1 | cut -c1-200; stamp "main on the copy, validated"
$HERE/push-dev.sh off 1 || exit 1; stamp "dev pushed, validation off"
cd $R/dev
npx convex run migrations/upgradeLiveData:run >/dev/null 2>&1
for i in $(seq 1 120); do npx convex run --component migrations lib:getStatus '{"limit":30}' 2>/dev/null > /tmp/st.json; python3 -I $HERE/migration-status.py strayCounts < /tmp/st.json > /tmp/st.txt; rc=$?; [ $rc -ne 3 ] && break; sleep 5; done; cut -c1-900 /tmp/st.txt; stamp "upgrade rc=$rc"; [ $rc -ne 0 ] && exit 1
for m in screeningOutcomes screeningSearch makerCounts pagedAccountLists placeRatings; do npx convex run migrations/$m:run >/dev/null 2>&1; done
for i in $(seq 1 60); do npx convex run --component migrations lib:getStatus '{"limit":60}' 2>/dev/null > /tmp/st.json; python3 -I $HERE/migration-status.py places < /tmp/st.json > /tmp/st.txt; rc=$?; [ $rc -ne 3 ] && break; sleep 5; done; stamp "follow-ups rc=$rc"; [ $rc -ne 0 ] && { cut -c1-900 /tmp/st.txt; exit 1; }
$HERE/push-dev.sh on 4 || { stamp "dev rejected with validation on"; exit 1; }; stamp "dev pushed, validation on"
rm -f $R/after.zip; npx convex export --path $R/after.zip 2>&1 | tail -1 | cut -c1-100
npx vite-node --config vitest.config.ts plans/production-launch/schema-check.ts $R/after.zip 2>&1 | tail -14 | cut -c1-170; rc=${PIPESTATUS[0]}; stamp "schema checked"
rm -f /tmp/st.json /tmp/st.txt
exit $rc
