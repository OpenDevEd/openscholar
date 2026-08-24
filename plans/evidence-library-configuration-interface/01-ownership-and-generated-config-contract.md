# Plan 01 — Ownership and Generated Configuration Contract

## Goal

Establish the drift-proof configuration input and lock the organization/library ownership contract before any UI or persistence work.

## Scope

- Add a deterministic sync/check command for the Evidence Library JSON Schema and catalog at an exact upstream commit.
- Record upstream repository, commit, schema/catalog versions and SHA-256 digests.
- Add a section presentation registry keyed only by validated section-root JSON Pointer paths.
- Define all 24 runtime sections for complete-file assembly and the authority of the visible first-version fields.
- Lock Clerk Organizations as identity and membership authority. `org:admin` manages configuration. `org:member` cannot open it.
- Correct the production model where the prototype is invalid; do not edit the standalone prototype.

Out of scope: Convex tables, route UI, remote activation.

## Design

1. `scripts/sync-evidence-library-config-contract.mjs` accepts an exact upstream SHA from the verified checkout at `/Users/mcharrad/Documents/Github/new-el-optimize` on branch `main`. It verifies the origin, tracked upstream branch and artifact ancestry before reading the exact Git objects. Generated output records only immutable artifact provenance and is independent of the mutable local checkout HEAD. `--check` performs no writes and fails on drift.
2. Generated files live under `lib/evidence-libraries/configuration/generated/` and carry a generated-file header/README. They are never hand-edited.
3. The generated schema declares JSON Schema draft 2020-12. Verify that at execution, then use the matching Ajv 2020 entry point plus a compatible `ajv-formats`. Compile once in a server-only module; expose normalized `ValidationIssue[]` values, not Ajv internals, to UI code.
4. `section-registry.ts` records every runtime section needed to assemble a complete file. Every section-root pointer and generated credential pointer must resolve in the upstream schema. The first-version page filters this contract to the fields named in Plan 04.
5. OpenScholar generates `schemaVersion`, `revision`, and `updatedAt`. These values do not appear as editable fields.
6. Contract provenance is a first-class value attached to every later draft and revision.
7. Pure sync/provenance/digest/registry logic and tests live under `lib/evidence-libraries/configuration/`, which Vitest includes. `scripts/sync-evidence-library-config-contract.mjs` is only a thin CLI shell.
8. Credential-lifecycle classification is derived from and asserted equal to the generated catalog's `fields.writeOnlyPaths`; the presentation registry may add labels but may not duplicate secret-path truth.

## TDD sequence

1. Red: sync parser rejects a moving branch, missing provenance, digest mismatch and a source artifact whose declared versions disagree.
2. Green: implement deterministic fetch/copy, canonical hashing, lock generation and `--check`.
3. Commit per green.
4. Red: registry test proves all 24 runtime sections exist exactly once and every JSON Pointer exists upstream. A separate test limits the visible page to the approved fields.
5. Green: implement section/path registry and contract access helpers.
6. Red: structural validator maps required/type/enum/format errors to stable JSON Pointer + section + message contracts.
7. Green: add Ajv-backed server-only validation and normalized issues.
8. Refactor only after all pure tests are green; commit each logical green separately.

## Files touched

- `package.json`, `package-lock.json`
- `scripts/sync-evidence-library-config-contract.mjs`
- `lib/evidence-libraries/configuration/contract-lock.json`
- `lib/evidence-libraries/configuration/contract-sync.mjs`
- `lib/evidence-libraries/configuration/contract-sync.test.ts`
- `lib/evidence-libraries/configuration/contract-sync-cli.test.ts`
- `lib/evidence-libraries/configuration/contract.ts` and `contract.test.ts`
- `lib/evidence-libraries/configuration/json-pointer.ts` and `json-pointer.test.ts`
- `lib/evidence-libraries/configuration/section-registry.ts` and `section-registry.test.ts`
- `lib/evidence-libraries/configuration/validation.ts` and `validation.test.ts`
- `lib/evidence-libraries/configuration/generated/README.md`
- `lib/evidence-libraries/configuration/generated/library-config.schema.json`
- `lib/evidence-libraries/configuration/generated/library-config.catalogs.json`

No `convex/`, `app/` or `components/` files.

## Migration stance

None. This plan introduces generated artifacts and pure code only. A version mismatch fails closed; no compatibility layer is allowed.

## Test plan

```bash
npm test -- lib/evidence-libraries/configuration
node scripts/sync-evidence-library-config-contract.mjs --check
npm run build
```

Also run `npm run schema:check` in the pinned Evidence Library checkout before accepting a new snapshot.

## Deployability gate

This plan does not touch a deployed tree. `npm run build` must still pass because generated JSON imports and server-only boundaries are build-sensitive.

## Acceptance criteria

- Exact upstream SHA and both digests are recorded and reproducible.
- `--check` is read-only and fails on any drift.
- Tests prove all 24 real runtime sections exist for complete-file assembly, with `sources` present and synthetic Meta absent.
- No invalid prototype value is promoted into the registry.
- Every section has an explicit default authority, and every generated credential path resolves to `credentialLifecycle`. Plans 04–05 expose only the approved fields and assemble the rest from managed values.
- No manually duplicated runtime enum or cross-field rule exists.
- Credential-lifecycle paths exactly match generated `fields.writeOnlyPaths`, and drift fails tests.
- Build passes.

## Known pitfalls

- GitHub repository privacy may require authenticated retrieval; never fall back to a branch URL.
- JSON Schema cannot express every Evidence Library cross-field rule.
- `ajv-formats` must match the installed Ajv version.
- Do not import the generated validator into a broad client bundle.
- Do not treat section labels or later field widget hints as runtime validation authority.

## Deviation — 2026-08-11

The original plan assigned per-field widget hints and every field-level authority classification to Plan 01 before field controls existed. The implementation established section defaults plus generated credential paths. The current first version exposes only identity, branding, and language fields. Plans 04–05 own that presentation and complete-file assembly.

## Deviation — 2026-08-11 — reproducible provenance

The first implementation serialized the neighboring checkout's current HEAD as `inspectedCheckoutCommit`. GPT-5.6 Sol review identified that this made committed generated output vary when unrelated local-only commits advanced that checkout, even though the pinned artifact commit and bytes were unchanged. Plan 01 now records only immutable repository, artifact commit, versions, digests and sizes. Checkout origin, branch, upstream ref and artifact ancestry remain mandatory preconditions, but the mutable checkout HEAD is not part of the generated contract.
