# Fable 5 review record

Historical record. This review covered the broader interface and rollback plan. The 2026-08-24 README and Plans 03–07 replace that scope.

- Reviewed: **2026-08-11 10:07:59 +01**
- Reviewer: Claude Code CLI, model `claude-fable-5`, effort `max`
- Mode: read-only (`Read`, `Glob`, `Grep` only)
- Scope: `AGENTS.md`, this complete plan set, the Anchor rail prototype, named OpenScholar donors, Convex/Next guidance, and the authoritative Evidence Library checkout at `/Users/mcharrad/Documents/Github/new-el-optimize`.

## First-pass verdict

**CHANGES REQUIRED**

Fable found the architecture sound but identified execution-level contradictions that could force an implementer to guess or stop mid-plan.

## Findings and disposition

| ID | Finding | Disposition |
|---|---|---|
| F1 | Secret resolution, digest input, health confirmation, and replay semantics conflicted with the current runtime. | Resolved in Plan 06: server-side pre-transport resolution, post-resolution validation, runtime-compatible canonical digest, receipt-first replay, and explicit new digest-health contract. |
| F2 | Prompts did not identify the non-sibling Evidence Library checkout/branch. | Resolved: both repository roots and grounded branch are explicit in every prompt and README sources. |
| F3 | Plan 06 prompt named nonexistent `validate.ts`/`activate.ts` donors. | Resolved: prompt now names `source.ts`, `activation.ts`, exact functions, CLI wrappers, and scripts. |
| F4 | Clerk Organizations/JWT/test identities were unowned prerequisites. | Resolved in Plan 02 scope, boot steps, provisioning, acceptance, and blocker rule. |
| F5 | Real acceptance had no source for target binding/platform service values. | Resolved: Plan 02 owns a dev-gated isolated-runtime provisioning seed and binding. |
| F6 | Plan 03 assumed an authenticated server-preload pattern absent from the repository. | Resolved: use existing `useProtectedQuery` client leaves behind `AuthRouteGate`; preload is deviation-gated. |
| F7 | Plan 01 prompt placed tested logic under a Vitest-excluded scripts directory. | Resolved: pure tested logic lives in `lib/**`; the script is a thin shell. |
| F8 | README rail order silently differed from schema key order. | Resolved: D11 locks generated-schema order and the inventory now follows it. |
| F9 | Plan 05 prompt could reject valid `append-system-instruction`. | Resolved: invalid `append` and `replace-system-instruction` are named; the valid action is preserved. |
| F10 | Plan 05 assumed a source-capability endpoint that does not exist. | Resolved: source keys receive local format/duplicate validation; endpoint-dependent capability UI is forbidden without a plan deviation. |
| F11 | Secret authority classification ignored generated `fields.writeOnlyPaths`. | Resolved: credential paths derive from and drift-test against the generated catalog. |
| F12 | Plans 05/06 deployability sections deferred exact commands. | Resolved: both now contain the commands and required success/error lines inline. |
| F13 | README inventoried this review before it existed. | Resolved by this file. |

## Non-blocking improvements incorporated

- Named the disjoint MEE DOI/Crossref/Zenodo worker boundary and authorized configuration-only Evidence Library paths.
- Named the Plan 03 route layout file.
- Grounded JSON Schema draft 2020-12 and Ajv 2020 selection.
- Tightened status refresh to explicit user events or Convex subscriptions only.
- Recorded additional invalid prototype processing and locale values.

## Re-review

**APPROVE** — focused Fable 5 verification found every F1–F13 item resolved, every `PROMPTS.md` block compliant and self-contained, and no new blocker. Its only non-blocking nit was to name `lib/evidence-libraries/configuration/` literally in Plan 06's Phase A prompt; that wording is now present.
