# Plan 03 — Route Shell and Anchor Rail

## Goal

Ship the real authenticated Evidence Library configuration route, header, exact 24-section Anchor rail and empty/loading/error/read-only states using production OpenScholar components.

## Scope

- Add Evidence Libraries navigation and index/configuration routes.
- Extract/generalize the existing settings shell visual donor.
- Build server-first page/layout boundaries and small interactive leaves.
- Implement native fragment navigation, responsive rail and current-section semantics.
- Render section frames from the registry; editors arrive in Plans 04–05.

## Design

1. Routes: `/evidence-libraries` and `/evidence-libraries/[libraryId]/configuration`; preserve `/library` for personal research.
2. Page/layout are Server Components rendering static structure. Authenticated Convex data loads in small client leaves via the repository's supported `useProtectedQuery` pattern from `lib/auth/use-auth-query.ts`, behind `AuthRouteGate`; no async Client Components. Introducing authenticated server-side `preloadQuery` token flow is out of scope unless grounded against current code/docs and committed as a plan deviation first.
3. The header shows library identity, draft/active revision status and explicit Save/Validate/Publish/Rollback affordance states. Envelope metadata is not a rail section.
4. The rail is registry-driven and contains exactly 24 anchors. Desktop is sticky; narrow screens use an accessible horizontal overflow rail.
5. Native `#section` URLs are authoritative. A dedicated leaf hook may bridge `IntersectionObserver` for visual scroll-spy state only, with cleanup, exhaustive dependencies and the required external-system comment. It must not mutate router/nuqs/form/backend state.
6. `aria-current="location"`, skip links, focus targets and reduced-motion behavior are first-class.
7. Members receive the same readable document with all mutation controls disabled and an explicit read-only status.

## TDD sequence

1. Red: route/auth tests prove unauthenticated redirect, missing library, cross-tenant denial and member read-only state.
2. Green: add routes/server boundaries and app-sidebar entry; commit.
3. Red: registry-render test proves 24 ordered unique headings/anchors, Sources present, Meta absent and one page H1.
4. Green: implement shell/header/section frames; commit.
5. Red: rail interaction tests cover fragment navigation, `aria-current`, keyboard focus and responsive overflow contract.
6. Green: implement Anchor rail and smallest-leaf observer; commit.
7. Red/green loading, error, conflict and empty states.
8. Refactor shared shell only after both settings and Evidence Library route tests are green.

## Files touched

- `app/evidence-libraries/{page,loading,error}.tsx`
- `app/evidence-libraries/[libraryId]/layout.tsx`
- `app/evidence-libraries/[libraryId]/configuration/{page,loading,error}.tsx`
- `components/evidence-libraries/configuration/{configuration-shell,anchor-rail,publish-header,configuration-section}.tsx`
- optional generalized shell under `components/settings/`
- `components/app-sidebar.tsx`
- `lib/auth/public-routes.ts` only if route policy requires it
- component/route/auth tests
- locale files for route/shell text

## Migration stance

None. No schema changes. Remove temporary placeholder section bodies when Plans 04–05 land; do not keep dual renderers.

## Test plan

```bash
npm test -- tests/public-routes-auth.test.ts tests/components/evidence-libraries
npm run build
npx pm2 logs next --lines 5 --nostream
```

Add a focused Playwright smoke for authenticated owner/member routing once the shell exists.

## Deployability gate

After every `app/` or `components/` commit:

```bash
npx pm2 logs next --lines 5 --nostream
```

Require a recent `✓ Compiled` or clean Turbopack `✓ Ready` plus HTTP 200 for the route, with no newer `Module not found`, `Type error`, `Failed to compile` or unhandled stack.

## Acceptance criteria

- Routes are distinct from personal `/library` and existing `/settings`.
- Owner and member states render correctly; forbidden users learn nothing about library existence.
- Exact 24-section order is registry-derived.
- Deep links, keyboard navigation, current-section semantics and responsive rail work.
- Page/layout remain server-first; no broad client boundary.
- No forbidden `useEffect` exists.
- Target tests, build and Next PM2 gate pass.

## Known pitfalls

- Do not nest the existing settings sidebar.
- Do not copy prototype CSS variables or standalone markup.
- Avoid hydration mismatch from reading `location.hash` during render.
- Observer callbacks must not synchronize application state.
- Async Server Component behavior belongs in Playwright, not forced into JSDOM.
