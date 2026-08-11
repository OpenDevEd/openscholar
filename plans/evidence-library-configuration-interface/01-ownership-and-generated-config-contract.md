# Plan 01 — Ownership and Generated Configuration Contract

## Goal

Establish the drift-proof configuration input and lock the organization/library ownership contract before any UI or persistence work.

## Scope

- Add a deterministic sync/check command for the Evidence Library JSON Schema and catalog at an exact upstream commit.
- Record upstream repository, commit, schema/catalog versions and SHA-256 digests.
- Add a presentation registry keyed only by validated JSON Pointer paths.
- Define the 24-section order and field-authority classes.
- Lock Clerk Organizations as identity/membership authority with `org:admin` manage and `org:member` read-only.
- Correct the production model where the prototype is invalid; do not edit the standalone prototype.

Out of scope: Convex tables, route UI, remote activation.

## Design

1. `scripts/sync-evidence-library-config-contract.mjs` accepts an exact upstream SHA and either the verified checkout at `/Users/mcharrad/Documents/Github/new-el-optimize` on branch `openscholar` or an authenticated immutable GitHub source. It writes generated artifacts plus `contract-lock.json`; `--check` performs no writes and fails on drift.
2. Generated files live under `lib/evidence-libraries/configuration/generated/` and carry a generated-file header/README. They are never hand-edited.
3. The generated schema declares JSON Schema draft 2020-12. Verify that at execution, then use the matching Ajv 2020 entry point plus a compatible `ajv-formats`. Compile once in a server-only module; expose normalized `ValidationIssue[]` values, not Ajv internals, to UI code.
4. `section-registry.ts` owns labels, help text, widget hints, ordering and authority—not schema constraints. Every registry path must resolve in the upstream schema.
5. The header owns `schemaVersion`, `revision` and `updatedAt`. The rail owns exactly the 24 runtime sections, including `sources`.
6. Contract provenance is a first-class value attached to every later draft and revision.
7. Pure sync/provenance/digest/registry logic and tests live under `lib/evidence-libraries/configuration/`, which Vitest includes. `scripts/sync-evidence-library-config-contract.mjs` is only a thin CLI shell.
8. Credential-lifecycle classification is derived from and asserted equal to the generated catalog's `fields.writeOnlyPaths`; the presentation registry may add labels but may not duplicate secret-path truth.

## TDD sequence

1. Red: sync parser rejects a moving branch, missing provenance, digest mismatch and a source artifact whose declared versions disagree.
2. Green: implement deterministic fetch/copy, canonical hashing, lock generation and `--check`.
3. Commit per green.
4. Red: registry test proves all 24 sections exist exactly once, every JSON Pointer exists upstream, authority is assigned, and envelope fields are excluded from the rail.
5. Green: implement section/path registry and contract access helpers.
6. Red: structural validator maps required/type/enum/format errors to stable JSON Pointer + section + message contracts.
7. Green: add Ajv-backed server-only validation and normalized issues.
8. Refactor only after all pure tests are green; commit each logical green separately.

## Files touched

- `package.json`, `package-lock.json`
- `scripts/sync-evidence-library-config-contract.mjs`
- `lib/evidence-libraries/configuration/contract-lock.json`
- `lib/evidence-libraries/configuration/generated/library-config.schema.json`
- `lib/evidence-libraries/configuration/generated/library-config.catalogs.json`
- `lib/evidence-libraries/configuration/{contract,section-registry,validation}.ts`
- corresponding `*.test.ts`

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
- Tests prove 24/24 real sections, with `sources` present and synthetic Meta absent.
- No invalid prototype value is promoted into the registry.
- Every editable/managed/secret classification is explicit.
- No manually duplicated runtime enum or cross-field rule exists.
- Credential-lifecycle paths exactly match generated `fields.writeOnlyPaths`, and drift fails tests.
- Build passes.

## Known pitfalls

- GitHub repository privacy may require authenticated retrieval; never fall back to a branch URL.
- JSON Schema cannot express every Evidence Library cross-field rule.
- `ajv-formats` must match the installed Ajv version.
- Do not import the generated validator into a broad client bundle.
- Do not treat field labels or widget hints as runtime validation authority.
