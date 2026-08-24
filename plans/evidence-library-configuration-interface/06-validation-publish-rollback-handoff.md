# Plan 06: validation, preview, and activation

## Goal

Validate the saved draft, preview the visible result, and activate one immutable requested revision.

## Scope

- Map structural validation errors back to visible fields or a named managed input.
- Call the Evidence Library's authenticated validator for runtime rules.
- Preview identity, branding, and language settings without deploying another app.
- Freeze the draft as an immutable requested revision.
- Start issue #26 for a new library or issue #65 for a running library.
- Mark the revision active only after the Evidence Library health route reports that exact revision.

Manual rollback, release selection, fleet rollout, and per-worker configuration are outside this plan.

## Design

Use the service authentication built by issue #18 and the Evidence Library endpoint from `OpenDevEd/new-el#54`. Bind each request to the organization, library, runtime, revision, and configuration digest. Retry the same requested revision safely.

For a running library, update `LIBRARY_CONFIG_JSON` and redeploy the whole repository Compose application. All services receive the same configuration. A failure records the failed operation and leaves the old active revision unchanged.

## Test-first steps

1. Test validation error mapping and the preview model.
2. Add the Validate and Preview actions.
3. Test immutable revision creation and duplicate activation requests.
4. Add the authenticated activation call and saved operation receipt.
5. Test success, rejection, timeout, and health mismatch.
6. Run one real activation against the isolated development Evidence Library.

## Files

- `lib/evidence-libraries/configuration/`
- `convex/evidenceLibraries/`
- `components/evidence-libraries/configuration/`
- focused unit, Convex, component, and Playwright tests

## Tests

```sh
npm test -- lib/evidence-libraries/configuration convex/evidenceLibraries tests/components/evidence-libraries
npx tsc --noEmit
npm run convex:push
npm run dev
```

Run the matching Evidence Library endpoint and runtime tests in `OpenDevEd/new-el`.

## Completion

Preview causes no deployment. Activation is authenticated and safe to retry. The UI reports success only after health confirms the requested revision. Failure keeps the previous revision active.
