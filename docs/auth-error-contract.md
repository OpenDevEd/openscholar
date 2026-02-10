# Auth Error Contract

This repo standardizes public Convex read queries to avoid page crashes for expected auth and ownership states.

## Canonical States

- `ok`: request is authorized and data payload is present.
- `unauthenticated`: caller has no authenticated user/session.
- `no_access`: caller is authenticated but cannot access the resource, or the protected resource is treated as inaccessible for non-enumeration.
- `not_found`: optional explicit missing resource state, used only after ownership is already established.

## Non-Enumeration Rule

For protected resources, do not leak existence to unauthorized callers.

- If ownership or membership cannot be proven, return `no_access`.
- Only use `not_found` after caller authorization has been established for that scope.

## Query Behavior

- Public read queries should not throw for expected auth/ownership outcomes.
- Mutations/actions may still throw for invalid operations.
- Frontend components must branch on status and render fallback UI for `unauthenticated` and `no_access`.

## Auth Readiness Phases

Client rendering and query execution now follow an explicit readiness state machine:

- `initializing`: AuthKit/Convex auth is still settling, or user sync is in progress.
- `authenticated`: Session is authenticated and user sync completed; protected queries may run.
- `anonymous`: Session is not authenticated.
- `sync_error`: Session exists but user sync retry budget was exhausted.

`useAuthReadiness()` exposes:

- `phase`
- `isBootstrapping`
- `canRunProtectedQueries`
- `retryUserSync()`

## Query Invocation Rules

Use shared auth-aware wrappers from `lib/auth/use-auth-query.ts`:

- `useProtectedQuery`: for protected reads; internally skips until `canRunProtectedQueries`.
- `useProtectedPaginatedQuery`: same for paginated reads.
- `useOptionalAuthQuery`: for public pages that optionally enrich UI for signed-in users.
- `useSubscriptionState`: canonical subscription readiness abstraction for optional-auth subscription surfaces.
- `useOptionalAuthQuery` now exposes a canonical settlement state:
  - `auth_loading`: auth/session still resolving.
  - `anonymous`: auth is settled and no user session exists.
  - `query_loading`: auth is settled and authenticated, but the optional query has not returned yet.
  - `ready`: auth + query are fully settled for UI decisions.

For paginated protected queries:

- `useProtectedPaginatedQuery` must treat Convex `LoadingFirstPage` as unsettled (`query_loading`), not `ready`.
- Use `hasLoadedFirstPage` and `isInitialLoading` to gate empty-state rendering.
- Never render list empty/no-access conclusions from `results.length === 0` before first-page settlement.

Do not call Convex `useQuery`/`usePaginatedQuery` directly in app UI.

- This prevents transient `null`/`[]` values from rendering signed-out or empty states before auth readiness settles.
- Loading, empty, and access-denied states must branch only after wrapper metadata indicates readiness.

## No-Assumption Rule

Auth-sensitive UI must not infer business state from unresolved auth/query data.

- Do not default unresolved subscription data to plan/status values (for example `subscription?.plan || "free"`).
- Only derive plan-gated UI (current plan badges, entitlement tabs, upgrade/downgrade controls) when settlement is `ready`.
- During `auth_loading` and `query_loading`, render neutral loading UI only (no entitlement assumptions).

For list UIs, use `getAuthSensitiveListRenderState` from `lib/auth/list-render-state.ts` and render in this strict order:

1. `loading`
2. `empty` / `filtered_empty`
3. `ready`

## UI Expectations

- Protected routes are gated by `AuthRouteGate` and public route policy in `lib/auth/public-routes.ts`.
- Unauthenticated users should see a sign-in call to action.
- Unauthorized users should see explicit “You do not have access” messaging.
- During `initializing`, UI must render loading states only (no empty or sign-in copy).
- Unexpected failures are handled by Next.js route-level error boundaries (`app/error.tsx`, route-level `error.tsx`, optional `app/global-error.tsx`).

## Debug Endpoints

Public debug/test endpoints must be gated by `ENABLE_PUBLIC_DEBUG_FUNCTIONS=true`.

- Default production posture is disabled.
- Disabled debug endpoints should fail with forbidden errors, but normal app pages should not depend on them.
