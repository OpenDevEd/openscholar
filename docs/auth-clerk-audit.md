# Clerk Auth Audit

This audit validates Clerk + Convex authentication implementation against current Clerk and Convex guidance.

Sources:
- Clerk middleware guidance: https://clerk.com/docs/reference/nextjs/clerk-middleware
- Clerk webhook verification guidance: https://clerk.com/docs/guides/development/webhooks/syncing
- Clerk Playwright testing guidance: https://clerk.com/docs/references/testing/playwright/overview
- Convex Clerk auth integration: https://docs.convex.dev/auth/clerk
- Community references:
  - https://stackoverflow.com/questions/78191539/verifywebhook-from-clerk-backend-webhooks-returns-false-even-when-passing-the
  - https://stackoverflow.com/questions/78651502/unable-to-store-user-info-in-convex-from-clerk-webhook-in-next-js-app
  - https://www.answeroverflow.com/m/1413340182421016656

## Middleware Behavior
- Pass: Clerk middleware protects by default and whitelists public paths through shared route policy.
- Gap: None.
- Fix: `proxy.ts` now uses Clerk-style matcher coverage including API/TRPC and delegates protection decisions to shared policy.
- Test Coverage:
  - `tests/proxy-auth-policy.test.ts`
  - `tests/public-routes-auth.test.ts`

## Public/Private Route Boundaries
- Pass: Public routes are explicit, including canonical `/sign-in` and `/sign-up`.
- Gap: None.
- Fix: Public API exceptions are explicit in `lib/auth/public-routes.ts` (`/api/openalex/search`).
- Test Coverage:
  - `tests/public-routes-auth.test.ts`
  - `tests/public-routes-legal.test.ts`

## Clerk Provider Setup
- Pass: `ClerkProvider` wraps `ConvexProviderWithClerk`, with readiness gating for protected query execution.
- Gap: None.
- Fix: No additional runtime changes required.
- Test Coverage:
  - `tests/auth-settlement-contract.test.ts`
  - `tests/paginated-settlement-contract.test.ts`

## Convex Auth Config
- Pass: Convex auth config uses Clerk JWT issuer + `applicationID: "convex"`.
- Gap: None.
- Fix: No additional changes required.
- Test Coverage:
  - Runtime validation via `npx convex dev --once`

## Webhook Verification and Event Handling
- Pass: Svix verification + deterministic event handling for `user.created`, `user.updated`, `user.deleted`.
- Gap: None.
- Fix: Added pure verification and event-processing helpers for deterministic tests.
- Test Coverage:
  - `tests/clerk-webhook-verification.test.ts`
  - `tests/clerk-webhook-handler.test.ts`
  - `tests/clerk-webhook-normalization.test.ts`

## User Lifecycle Sync
- Pass: User records keyed by `clerkId`; upsert/delete paths implemented for Clerk events and sign-in fallback sync.
- Gap: None.
- Fix: No additional model changes required.
- Test Coverage:
  - `tests/clerk-webhook-handler.test.ts`
  - `tests/clerk-webhook-normalization.test.ts`

## Sign-In / Sign-Up / Sign-Out UX Contract
- Pass: Canonical routes are `/sign-in` and `/sign-up`; sign-out uses Clerk API.
- Gap: None.
- Fix: Added E2E coverage for auth lifecycle (anonymous redirect, sign-in access, sign-out reset).
- Test Coverage:
  - `e2e/auth.spec.ts`

## Provider Contract Enforcement
- Pass: Removed-provider references are no longer allowed in tracked source/docs/config.
- Gap: Local ignored env files can still contain stale environment values.
- Fix: Added static contract test and documented local cleanup requirement.
- Test Coverage:
  - `tests/auth-provider-contract.test.ts`

## External Cross-Check (Docs + User Reports)
- Pass: Implementation now matches documented requirements for matcher scope, Svix verification inputs, Convex JWT config, and Clerk Playwright setup.
- Gap: Community reports repeatedly show failures caused by webhook secret format mistakes and non-raw payload handling.
- Fix:
  - Verification now normalizes the webhook secret input (trim + quote stripping) and rejects non-`whsec_` formats with a deterministic error.
  - Verification continues to use `req.text()` and Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`) before event dispatch.
  - Event ID fallback uses `svix-id` when payload ID is absent, while requiring a valid event type.
- Test Coverage:
  - `tests/clerk-webhook-verification.test.ts`
  - `tests/clerk-webhook-handler.test.ts`
  - `tests/clerk-webhook-normalization.test.ts`

## Env + CI Posture
- Pass: Required PR CI now runs unit/build and required auth E2E.
- Gap: CI requires Clerk/Convex secrets to be configured in repository settings.
- Fix: Added GitHub Actions workflow with secret validation and deterministic E2E execution.
- Test Coverage:
  - `.github/workflows/ci.yml`
  - `npm run test:ci`

## Auth Audit Maintenance
- Any auth routing/middleware change must update:
  - `lib/auth/public-routes.ts`
  - `lib/auth/proxy-policy.ts`
  - `tests/public-routes-auth.test.ts`
  - `tests/proxy-auth-policy.test.ts`
- Any webhook behavior change must update:
  - `convex/webhooks/actions.ts`
  - `convex/webhooks/clerk.ts`
  - `tests/clerk-webhook-verification.test.ts`
  - `tests/clerk-webhook-handler.test.ts`
- Any migration that risks reintroducing removed providers must keep `tests/auth-provider-contract.test.ts` passing.
