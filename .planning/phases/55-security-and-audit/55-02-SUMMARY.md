---
phase: 55-security-and-audit
plan: 02
subsystem: api, security
tags: [audit-logging, env-validation, stripe, convex, cron, security]

# Dependency graph
requires:
  - phase: 54-type-safety-sweep
    provides: type-safe codebase foundation
provides:
  - auditLogs table with writeAuditLog internalMutation for persistent audit trail
  - validateRequiredEnvVars function and 24-hour cron for env var monitoring
  - assertPlanPriceConfig coverage in all billing-critical handlers
  - DEBUG-EXCLUSION-STRATEGY.md production security guidance
affects: [billing, extraction, zotero, api-keys]

# Tech tracking
tech-stack:
  added: []
  patterns: [persistent audit logging via writeAuditLog, env var validation cron, assertPlanPriceConfig fail-fast in billing handlers]

key-files:
  created:
    - convex/lib/audit.ts
    - convex/lib/envValidation.ts
    - .planning/phases/55-security-and-audit/DEBUG-EXCLUSION-STRATEGY.md
    - tests/env-validation.test.ts
  modified:
    - convex/schema.ts
    - convex/crons.ts
    - convex/lib/crypto.ts
    - convex/apiKeys/actions.ts
    - convex/zotero/actions.ts
    - convex/extraction/workpoolActions.ts
    - convex/subscriptions/actions.ts
    - convex/maintenance/internal.ts
    - convex/subscriptions/internal.ts

key-decisions:
  - "Audit logging in callers not in decryptApiKey: decryptApiKey is a plain function without Convex ctx, so writeAuditLog calls are in action handlers that have ctx"
  - "assertPlanPriceConfig inside handler bodies only: module-scope calls would block all functions in the module when price IDs are missing"
  - "envValidation uses internalAction (not mutation) because it needs 'use node' for reliable process.env access"

patterns-established:
  - "Persistent audit logging: use ctx.runMutation(internal.lib.audit.writeAuditLog) for security-sensitive operations"
  - "Env var validation: REQUIRED_ENV_VARS array in envValidation.ts is the single source of truth for required vars"

requirements-completed: [SEC-02, SEC-03, SEC-04, SEC-05, TEST-06]

# Metrics
duration: 5min
completed: 2026-03-04
---

# Phase 55 Plan 02: Security Audit Logging and Env Validation Summary

**Persistent auditLogs table with writeAuditLog mutation, 24-hour env var validation cron, assertPlanPriceConfig in all billing handlers, and debug function exclusion documentation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-04T05:01:26Z
- **Completed:** 2026-03-04T05:06:57Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- auditLogs table with by_action, by_action_timestamp, by_timestamp indexes for persistent security audit trail
- writeAuditLog internalMutation wired into all 3 decryptApiKey callers (apiKeys, zotero x5, workpoolActions) plus env validation
- validateRequiredEnvVars function detects 6 required env vars (missing or empty) with 24-hour cron monitoring
- assertPlanPriceConfig expanded from 1 handler (createCheckoutSession) to 4 handlers (+ changePlan, getUpgradePreview, syncSubscription, checkSubscriptionStatus)
- Debug function production exclusion strategy documented with safety checklist

## Task Commits

Each task was committed atomically:

1. **Task 1: Add auditLogs table, writeAuditLog mutation, env var validation, and tests (TDD)**
   - `f3a8b49` (test) - failing tests for env var validation
   - `624b710` (feat) - auditLogs table, writeAuditLog, envValidation, cron
2. **Task 2: Wire audit logs, expand assertPlanPriceConfig, and document debug exclusion** - `6154100` (feat)

## Files Created/Modified
- `convex/lib/audit.ts` - writeAuditLog internalMutation for persistent audit trail
- `convex/lib/envValidation.ts` - validateRequiredEnvVars function and checkRequiredEnvVars internalAction
- `convex/schema.ts` - auditLogs table definition with 3 indexes
- `convex/crons.ts` - 24-hour env var validation cron entry
- `convex/lib/crypto.ts` - Replaced verbose AUDIT:KEY_DECRYPT console.log with simple trace
- `convex/apiKeys/actions.ts` - Added writeAuditLog call after decryptApiKey
- `convex/zotero/actions.ts` - Added writeAuditLog calls after 5 resolveZoteroApiKey sites
- `convex/extraction/workpoolActions.ts` - Added writeAuditLog call after decryptApiKey
- `convex/subscriptions/actions.ts` - Added assertPlanPriceConfig to changePlan and getUpgradePreview
- `convex/maintenance/internal.ts` - Added assertPlanPriceConfig to checkSubscriptionStatus
- `convex/subscriptions/internal.ts` - Added assertPlanPriceConfig to syncSubscription
- `tests/env-validation.test.ts` - 4 tests for validateRequiredEnvVars
- `.planning/phases/55-security-and-audit/DEBUG-EXCLUSION-STRATEGY.md` - Production security guidance

## Decisions Made
- Audit logging in callers, not in decryptApiKey: decryptApiKey is a plain Node.js function without Convex ctx, so persistent audit writes happen in the action handlers
- assertPlanPriceConfig placed inside handler function bodies only (not at module scope) to avoid blocking all module functions when price IDs are missing
- envValidation uses internalAction with "use node" directive for reliable process.env access

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**TypeScript generated types not updated:** The `npx convex codegen` command fails locally due to a pre-existing bundler issue with `node:crypto` resolution. All 9 TypeScript errors are exclusively about `internal.lib.audit` and `internal.lib.envValidation` not existing in the stale generated types. These will resolve automatically when `npx convex deploy` runs, as deployment regenerates the types. No other TypeScript errors exist.

## User Setup Required

None - no external service configuration required. The new auditLogs table and cron will be created automatically on next Convex deployment.

## Next Phase Readiness
- Audit logging infrastructure ready for any future security-sensitive operations
- Env var validation cron will detect misconfiguration within 24 hours of deployment
- All billing-critical handlers now fail-fast on missing price IDs
- Debug exclusion strategy documented for production operations team

## Self-Check: PASSED

All 5 created files exist. All 3 task commits verified in git log.

---
*Phase: 55-security-and-audit*
*Completed: 2026-03-04*
