# Cite the saved abstract behind an extraction answer

Follow [AGENTS.md](../AGENTS.md) and the [project guide](../docs/agents/project.md).

## Contract and scope

An answer is grounded only when it cites a validated passage from its paper's
saved source. Abstract citations identify the saved abstract version, exact
quote and character range. They have no page number. PDF citations retain page
navigation. A missing answer, a failed extraction and an uncited answer remain
different states. Keep original model confidence separate from evidence status.

Reuse the existing structured model output, evidence policy and citation panel.
The abstract path supplies deterministic passage IDs in its existing model call.
No embeddings or extra model call is needed for anchors. The decision-model path
can keep an uncited answer as best effort. Do not change model selection.

The saved abstract is the source snapshot. Normalize only for passage generation
and use the same normalization to validate offsets and render highlights. Include
the paper ID and a SHA-256 source hash in citation identity. Validate IDs, quotes,
ranges and source identity at the shared result writer. Passage validity alone
does not establish that the passage supports the answer; inspect a bounded Luna
evaluation for that question.

## Ownership and data

- `convex/extraction/evidence_units.ts` owns passage chunk boundaries.
- `lib/extraction/evidence-policy.ts` owns evidence status.
- A shared citation contract owns the PDF and abstract variants and validation.
- `convex/extraction/mutations/results.ts` enforces the saved-result invariant.
- The existing answer/citation panel shows the source and saved passage, with
  PDFs off as well as on. Show the small in-app source-label mock first.

Widen the citation validator before migrating retained results. Recover an old
PDF citation only from that paper's matching retained evidence unit. Never fetch
a new abstract or invent a historical quote. Preserve answers, reasoning and
confidence when correcting old evidence status. Record a repair version and a
guarded before/after receipt. Back up, audit, dry-run, migrate in bounded batches,
verify every changed row and retry before removing transitional citation shapes.

The 4 October development backup has 5,422 extraction results, including 2,598
marked grounded without citations. It has no saved citations or evidence units.
Those are snapshot counts, to be checked again before repair.

## Checks and completion

Use the pure citation boundary and real result mutation tests for wrong paper,
stale source, invalid offsets, missing IDs, null answers, zero confidence and
PDF/abstract variants. Prove the worker emits usable abstract citations on an
isolated preview, then open the saved passage in the browser. Inspect actual
downloaded data after the export phase. Migration must preserve unrelated state
and refuse rollback over subsequent edits. Complete when the deployed writer,
reader, historical repair and browser passage agree. Extraction chat is excluded.
