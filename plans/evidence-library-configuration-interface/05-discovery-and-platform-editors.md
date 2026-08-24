# Plan 05: save drafts and build the complete configuration

## Goal

Save the visible fields and combine them with managed values so the Evidence Library receives one complete valid configuration file.

## Scope

- Save and reload the three visible field groups.
- Keep optimistic edit-version checks so stale saves do not overwrite newer work.
- Fill deferred sections from the pinned defaults, catalogs, credentials, and the library runtime binding.
- Keep secrets out of draft sections, queries, browser output, and logs.
- Refresh the pinned schema and catalogs from `OpenDevEd/new-el/main` before changing assembly code.

## Design

Reuse the existing draft, section, revision, credential, and runtime-binding functions in `convex/evidenceLibraries/`. Keep visible owner input separate from platform-managed values.

Add one pure assembler under `lib/evidence-libraries/configuration/`. It takes the saved visible fields and explicit managed inputs. It returns the complete configuration and a list of missing managed inputs. It must not guess values or hide missing credentials with placeholders.

## Test-first steps

1. Test save, reload, stale edit rejection, and wrong-organization denial.
2. Add the smallest save mutation changes needed by the visible groups.
3. Test deterministic assembly from the visible fields and managed inputs.
4. Add schema and catalog defaults without copying them into hand-written constants.
5. Test missing platform values and credentials as named errors.
6. Prove the assembled file passes the pinned structural validator.

## Files

- `convex/evidenceLibraries/`
- `lib/evidence-libraries/configuration/`
- `scripts/sync-evidence-library-config-contract.mjs` only if the existing sync needs a branch correction
- focused Convex and pure tests

## Tests

```sh
npm test -- lib/evidence-libraries/configuration convex/evidenceLibraries
npx tsc --noEmit
npm run convex:push
```

## Completion

An owner can save, reload, and assemble a complete configuration. A stale or unauthorized save fails. Hidden fields have a named source. No secret is stored in an ordinary draft section.
