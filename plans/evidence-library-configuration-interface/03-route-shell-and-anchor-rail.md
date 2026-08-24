# Plan 03: configuration route and page shell

## Goal

Add the owner-only configuration page with three visible groups: identity, branding, and languages.

## Scope

- Add `/evidence-libraries/[libraryId]/configuration`.
- Show the library name, draft state, and active revision.
- Add links for Identity, Branding, and Languages.
- Show Save, Validate, Preview, and Activate actions.
- Reject members and users from another organization. Do not build a read-only configuration page for them.

## Design

Use Server Components for the page shell. Put protected Convex reads in the smallest client components that need them. Reuse `AuthRouteGate`, `useProtectedQuery`, the existing settings rail styles, and `components/ui/`.

The three links use native fragment URLs. The page has one heading and one heading per group. Do not add the 21 deferred runtime sections to the page.

## Test-first steps

1. Test signed-out, wrong-organization, member, owner, missing-library, loading, and error states.
2. Add the route and server-first shell.
3. Test the three ordered links, headings, focus targets, and action labels.
4. Add the small responsive rail and header actions.
5. Run the route in the real browser with hosted Clerk and hosted Convex.

## Files

- `app/evidence-libraries/[libraryId]/configuration/`
- `components/evidence-libraries/configuration/`
- `components/app-sidebar.tsx`
- route and component tests
- locale files touched by the new page

## Tests

```sh
npm test -- tests/public-routes-auth.test.ts tests/components/evidence-libraries
npx tsc --noEmit
npm run dev
```

## Completion

The owner can open the page and move between the three groups. Everyone else is denied on the server. The page works at desktop and mobile widths and has no application-state effect.
