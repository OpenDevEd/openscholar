# Plan 07: browser and release checks

## Goal

Prove the whole first-version configuration journey with real Clerk, hosted Convex, and the isolated Evidence Library runtime.

## Checks

1. Owner opens the page, changes every visible field, saves, leaves, and reloads the same values.
2. Member, signed-out user, and another organization cannot read or change the draft.
3. Invalid URLs, colours, names, and language choices show accessible field errors.
4. Preview shows the saved identity, branding, and languages and creates no deployment.
5. Activation creates one immutable revision, survives retry, and becomes active only after exact health readback.
6. A rejected configuration or failed deployment leaves the previous revision active.
7. Desktop and mobile keyboard use works without disabled axe rules.

## Test order

Run focused tests while coding. Before the final push, run:

```sh
npm test -- lib/evidence-libraries/configuration convex/evidenceLibraries tests/components/evidence-libraries tests/a11y/evidence-library-configuration.axe.test.tsx
npx tsc --noEmit
npm run build
npm run convex:push
npm run dev
npx playwright test e2e/evidence-library-configuration.spec.ts --config=playwright.config.ts
```

Use the real development Compose app for the final activation check. Read back its source branch, deployment commit, service health, and active configuration revision.

## Completion

The checks above pass. The diff has no deferred editors, manual rollback UI, general app-release code, duplicate schema constants, dead components, application-state effects, or class-string tests.
