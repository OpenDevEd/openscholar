# Plan 06 — Validation, Publish, Rollback, and Handoff

## Goal

Assemble a normalized manifest, validate authoritatively, publish idempotently to the correct Evidence Library, read back exact health, and model rollback as a new revision.

## Scope

- Add candidate assembly from the 24 draft sections and generated envelope.
- Add structural and authoritative validation stages.
- Define and implement an OpenScholar activation adapter.
- Add typed operation stages, receipts, retries and sanitized failures.
- Implement Publish and Rollback user flows.

## Design

1. Draft candidate assembly is pure and deterministic: ordered sections + control-plane envelope + credential references. Drafts, revisions and operation logs never contain resolved secret values.
2. Immediate structural validation uses the pinned artifact but partitions required/write-only-path errors into credential-status issues backed by metadata; it never inserts placeholder secrets. All non-secret structural errors remain ordinary section/field issues.
3. An OpenScholar server-side action resolves credential references immediately before transport because the runtime schema structurally requires `services.search.key` and `services.storage.serviceRoleKey`, and conditionally requires enabled AI-provider keys. The action assembles the resolved wire manifest in memory, never logs or persists it, and reruns full pinned structural validation.
4. Final validation calls the Evidence Library's authoritative validator because JSON Schema omits cross-field rules. Reuse `source.ts` donors `validateLibraryConfigFile`, `digestLibraryConfig`, `assertLibraryConfigRevisionAdvances`, plus `activation.ts`; do not reimplement their semantics.
5. The activation contract is authenticated, versioned and idempotent. Request identity includes control-plane library ID, target runtime ID, contract provenance, revision and a sha256 digest over the canonical fully resolved manifest—the same input contract as runtime `digestLibraryConfig`.
6. The adapter stores a receipt before forwarding. First use activates once; same revision + same digest returns the stored receipt without re-invoking activation; same revision + different digest is rejected. This preserves the runtime's `REVISION_REUSED`/`REVISION_NOT_NEWER` rules, and every new activation has an `updatedAt` later than the active revision.
7. Publish creates an immutable OpenScholar revision before dispatch, records operation state, and marks it active only after Evidence Library health reports the exact revision and contract-added digest. Digest echo in receipts/health is a required addition to the new remote contract; current health has revision only.
8. Failure leaves the prior active revision unchanged and exposes actionable stage/error data.
9. Rollback never reuses an old revision identifier. It creates a new revision from selected historical content and activates that new revision.
10. If the authenticated Evidence Library validation/activation/receipt-and-digest-bearing-health contract genuinely does not exist, follow the repository blocker protocol and write `06-BLOCKER.md`. Do not use direct filesystem, SQL or unauthenticated admin bypass as a substitute.

## TDD sequence

1. Red/green deterministic draft assembly, timestamp/revision generation, secret-path partitioning and canonical resolved-manifest digest tests; commit.
2. Red/green structural issue mapping, credential-status issues and validation-summary anchor links; commit.
3. Red: adapter contract tests for authentication, target identity, idempotent replay, digest conflict, timeout and sanitized error.
4. Green: implement adapter against the approved Evidence Library endpoint/shared validator; commit.
5. Red/green operation-state machine tests including retry boundaries and active-revision invariants.
6. Red/green Publish UI handler, validation jump and receipt timeline.
7. Red/green Rollback creates a new revision and preserves history.
8. Real-service acceptance using Plan 02's dev-gated runtime seed/service values: resolve secrets, validate, activate, read revision+digest health, replay idempotently without a second activation, reject a failed candidate and roll back.

## Files touched

- `lib/evidence-libraries/configuration/{assemble,digest,activation-adapter,operations}.ts`
- `convex/evidenceLibraries/{operations,queries,mutations,actions}.ts`
- `components/evidence-libraries/configuration/{publish-header,validation-summary,operation-timeline,rollback-dialog}.tsx`
- focused tests and `e2e/evidence-library-configuration.spec.ts`
- Evidence Library configuration contract files only if separately authorized: `src/config/library-config/**`, `src/app/api/library-config/**`, `public/library-config.*.json`, `tools/*LibraryConfig*.ts`, and related `docs/`; never touch the separately owned MEE DOI/Crossref/Zenodo deposit worker

## Migration stance

No compatibility transport. This is the first contract. Development operation/revision tables may be wiped if their pre-testing shape changes.

## Test plan

```bash
npm test -- lib/evidence-libraries/configuration convex/evidenceLibraries tests/components/evidence-libraries
npx playwright test e2e/evidence-library-configuration.spec.ts --config=playwright.config.ts
npx convex function-spec | rg 'evidenceLibraries'
npx pm2 logs convex --lines 5 --nostream
npx pm2 logs next --lines 5 --nostream
```

Run the Evidence Library's relevant schema and activation tests plus a real isolated runtime acceptance target.

## Deployability gate

After every backend commit, run `npx pm2 logs convex --lines 5 --nostream` and require `✔ Convex functions ready!` with no newer `✖ Error`; inspect new public validators with `npx convex function-spec | rg 'evidenceLibraries'`. After every UI commit, run `npx pm2 logs next --lines 5 --nostream` and require a recent `✓ Compiled` with no module/type/compile error. A real publish is accepted only when the new receiving-runtime health contract reports the exact expected revision and digest and no newer rejected candidate displaced the last valid manifest.

## Acceptance criteria

- Candidate assembly is deterministic and carries exact provenance/digest.
- Validation issues navigate to accessible section/field targets.
- Publish is authenticated, target-bound and idempotent.
- Failed validation/activation never changes the active revision.
- Operation receipt/state survives reload.
- Rollback creates and activates a new revision while preserving history.
- Real-service acceptance and both PM2 gates pass.

## Known pitfalls

- Current Evidence Library supports filesystem activation, not this remote API.
- Current `LibraryConfigHealth` has no digest field; revision/digest receipts and health are part of the missing new contract, not present behavior.
- Do not claim a queued request is published.
- Do not treat HTTP success as activation success; health readback is required.
- Never embed secrets in the manifest draft/operation log.
- Avoid retrying permanent validation/auth conflicts.
