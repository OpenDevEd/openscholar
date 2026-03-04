# Debug Function Production Exclusion Strategy

## 1. Current State

There are 12 debug-gated files in `convex/extraction/`, all protected by the `requirePublicDebugEnabled()` env var gate from `convex/lib/debug_gate.ts`. When `ENABLE_PUBLIC_DEBUG_FUNCTIONS` is not set to `"true"`, every call to these functions throws a `FORBIDDEN` error. Access attempts are logged via `console.log("[AUDIT:DEBUG_ACCESS]")` when the gate passes.

## 2. Why File-Level Exclusion Is Not Available

Convex deploys ALL `.ts` files in the `convex/` directory. There is no `exclude` option in `convex.config.ts` or the Convex CLI. Unlike Next.js, Webpack, or similar bundlers, Convex has no file-level deploy exclusion mechanism. All functions in the `convex/` directory are bundled and deployed together.

This means debug/test functions ship to production. However, the runtime env var gate ensures they are never callable unless explicitly enabled.

## 3. Production Safety Checklist

1. **`ENABLE_PUBLIC_DEBUG_FUNCTIONS` must NEVER be set to `"true"` in the production Convex deployment dashboard.** This is the single most important control. Without this env var, all 12 debug files are inert (every call throws FORBIDDEN).

2. **The env var validation cron** (added in Phase 55) monitors required environment variables every 24 hours and writes failures to the `auditLogs` table. While this cron does not specifically check for the debug env var, any unexpected env var configuration changes can be detected through the audit trail.

3. **Debug function access is logged** via `console.log("[AUDIT:DEBUG_ACCESS]")` in `requirePublicDebugEnabled()`. This is ephemeral (Convex function logs, not persisted to the `auditLogs` table). This is acceptable because debug functions should never be enabled in production -- the log serves as an emergency forensic trail only.

4. **The debug gate inventory test** (`tests/debug-gate.test.ts`) verifies that all 12 files import and call `requirePublicDebugEnabled`. Any new debug file added without the gate will fail CI.

## 4. Recommended Staging Setup

Use a separate Convex project for staging (e.g., `openalex-count-staging`) where debug functions are enabled:

- **Staging project:** Set `ENABLE_PUBLIC_DEBUG_FUNCTIONS=true` in the staging Convex dashboard
- **Production project:** Never set the debug env var (or explicitly set it to `"false"`)
- **Deployment:** Use `npx convex deploy --project <name>` to target the correct project

This separation ensures debug endpoints are never accidentally exposed in production.

## 5. Affected Files

All 12 debug-gated files in `convex/extraction/`:

1. `convex/extraction/debug.ts`
2. `convex/extraction/debug_errors.ts`
3. `convex/extraction/debug_papers.ts`
4. `convex/extraction/debug_paper_results.ts`
5. `convex/extraction/debug_job_content.ts`
6. `convex/extraction/debug_job_citations.ts`
7. `convex/extraction/debug_pdfjs_alignment.ts`
8. `convex/extraction/testActions.ts`
9. `convex/extraction/test_runner.ts`
10. `convex/extraction/test_automation.ts`
11. `convex/extraction/test_automation_internal.ts`
12. `convex/extraction/create_test_job.ts`
