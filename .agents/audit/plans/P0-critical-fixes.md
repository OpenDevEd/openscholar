# P0 — Critical Fixes (Security, Correctness, Money)

**Intended reader:** an autonomous coding agent picking this up cold. You have not seen the audit, you have not seen the codebase. Everything you need is linked below.

---

## 1. Mission

Fix 8 critical issues in the data extraction pipeline that currently allow (a) SSRF to internal services, (b) one user to cancel every other user's in-flight work, (c) silently double-charging customers, (d) resurrecting cancelled jobs, and (e) queueing unbounded cost-bomb jobs.

The extraction pipeline takes research papers (PDFs + metadata), chunks them, runs an LLM over each chunk to extract structured answers to user-supplied questions, and persists evidence with citations. It is customer-facing, credit-metered, and billed.

All fixes are in `convex/extraction/` (Convex backend) with a small side-trip into `lib/pdf/download.ts`.

---

## 2. Hard rules (from `CLAUDE.md`)

These override anything else:

1. **DRY.** Before adding anything new, look for an existing helper to extend. Examples live in `convex/lib/`, `lib/auth.ts`, `convex/screening/cancel.test.ts` (cancel pattern).
2. **No legacy / backwards compat.** Delete old paths, don't feature-flag them. The project is pre-release; there is no production data to preserve compatibility for.
3. **No dead code.** If a function has no callers, delete it in the same commit.
4. **Convex rules override your memory.** Read `convex/_generated/ai/guidelines.md` before writing any query/mutation/action.
5. **Best practices always.** Use `withIndex` not `.filter`, use `internalMutation` for internal-only, use `Id<"table">` not `string`, use `tokenIdentifier` not `subject`.

---

## 3. Required reading (before touching code)

Read in this order:

1. **Consolidated report** — the big picture: `/Users/mcharrad/Documents/Github/openalex-count/.agents/audit/00-CONSOLIDATED.md` (§P0)
2. **Security report** — full SSRF + auth + array-cap details: `.agents/audit/01-security.md`
3. **Bug report** — cancellation + finalize race + double-finalize details: `.agents/audit/02-bugs.md`
4. **Data flow report** — pipeline map + billing idempotency: `.agents/audit/06-dataflow.md`
5. **Convex guidelines** — `convex/_generated/ai/guidelines.md`
6. **Pipeline orchestrator** — `convex/extraction/workflow.ts` (only 245 lines — read fully)
7. **Cancel pattern reference** — `convex/screening/cancel.test.ts` (shows per-job cancellation done right)

Skim as needed:

- `convex/extraction/mutations.ts` — the god file, 2288 lines. Read around the line numbers cited in tasks.
- `convex/extraction/workpoolActions.ts` — billing/LLM calls.
- `convex/schema.ts` — `extractionJobs`, `extractionPapers`, `extractionJobStats` definitions.
- `convex/extraction/index.ts` — public API surface.

---

## 4. Task list

Tasks are **ordered** — later tasks may depend on earlier ones. Each is an atomic commit. After each, run typecheck + tests before moving on.

---

### Task 1: Guard `finalizeJob` / `finalizeJobIfDone` against cancelled jobs

**Why:** A cancelled job today gets resurrected to `completed` or `failed` by any late paper that finishes after the cancel. Compounded by the credit-guard in `waitAndExtractAction` that returns `{success: true, results: []}` when credits run out — the completion handler saves it as a terminal success.

**Files & line numbers** (verify before editing; lines may drift):

- `convex/extraction/mutations.ts:1536` — `finalizeJob`
- `convex/extraction/mutations.ts:1619` — `finalizeJobIfDone`
- `convex/extraction/workpoolActions.ts:978-988` — credit-guard short-circuit
- `convex/extraction/mutations.ts:2098` — `saveExtractionResultsAndComplete`

**Target behavior:**

- At the top of `finalizeJob` and `finalizeJobIfDone`, load the job and early-return if `job.status === "cancelled"` or `job.status === "failed"`. Terminal states are sticky — nothing moves a job out of `cancelled`/`failed`/`completed` except admin action.
- In `saveExtractionResultsAndComplete`, if the job is already cancelled/failed/completed, **do not** persist new results and **do not** call finalize. Log and return.
- In `waitAndExtractAction` credit-guard path (lines 978-988), do NOT return `{success: true, results: []}`. Return a dedicated kind, e.g. `{ kind: "credits_exhausted" }`, and handle that in `handleExtractionComplete` by marking the paper `extraction_failed` with a clear error, not as a successful extraction.

**Acceptance:**

- [ ] Add a test in `convex/extraction/cascade-delete.test.ts` OR a new `cancel-finalize.test.ts`: cancel a job, then fire a late onComplete — job must remain `cancelled`.
- [ ] Add a test: credit-guard fires → paper ends `extraction_failed`, job stats reflect it, no revenue-positive row persisted.
- [ ] `npx convex typecheck` clean.
- [ ] `npm test -- convex/extraction` passes.

---

### Task 2: Eliminate double-finalize in `handleExtractionComplete`

**Why:** `handleExtractionComplete` (mutations.ts:1951-) calls `finalizeJobIfDone` directly AND schedules `saveExtractionResultsAndComplete`, which calls `finalizeJobIfDone` again transitively. Double call inflates stats and can race.

**Files & lines:**

- `convex/extraction/mutations.ts:1979` — direct call site to remove
- `convex/extraction/mutations.ts:2237` — transitive call inside `saveExtractionResultsAndComplete` (keep this one)

**Target behavior:** `saveExtractionResultsAndComplete` is the single terminal point; it owns the finalize call. `handleExtractionComplete` only schedules the save mutation and exits.

**Acceptance:**

- [ ] Only one code path reaches `finalizeJobIfDone` for any given paper completion.
- [ ] Test: simulate onComplete firing, assert `finalizeJobIfDone` invoked at most once per paper (spy / counter mutation).
- [ ] Typecheck + tests pass.

---

### Task 3: Scope cancellation to the job (stop nuking every user's work)

**Why:** `cancelExtraction` currently calls `pdfProcessingPool.cancelAll(ctx)` which cancels pending items across **all** jobs in the shared workpool. Cancelling job A of user X fails half the papers of job B of user Y. The code comment admits the scope.

**Files & lines:**

- `convex/extraction/mutations.ts:241-286` — `cancelExtraction`
- `convex/extraction/mutations.ts:278-282` — the `cancelAll(ctx)` call to remove
- Reference: `convex/screening/` (see how screening cancels per-job)
- `convex/extraction/mutations.ts:1786` — `enqueuePaperProcessing` (stores `workId` somewhere? Check)
- `convex/schema.ts` — `extractionPapers` table

**Target behavior:**

1. When `enqueuePaperProcessing` enqueues, capture the returned workpool `workId` and patch it onto the `extractionPapers` row (add column `workId: v.optional(v.string())` in the schema if missing).
2. In `cancelExtraction`, load every non-terminal paper for this job, call `pdfProcessingPool.cancel(ctx, paper.workId)` for each one (batch via `Promise.all` or `for await` as Convex prefers).
3. Do NOT call `cancelAll`. Remove the import if unused.
4. Ensure per-paper cancel is idempotent: cancelling an already-finished work is a no-op; wrap in try/catch to swallow "not found" errors only.

**Schema migration note:** `workId` is a new field. Since CLAUDE.md says no backwards compat, just add it. No migration needed for dev data.

**Acceptance:**

- [ ] `grep -n "cancelAll" convex/extraction/mutations.ts` returns empty.
- [ ] Test: run 2 jobs from 2 users in parallel (via `convex-test` impersonation), cancel job A, assert job B's papers stay `running` / `indexing`.
- [ ] Test: cancel a job whose papers are already done — no crash, job state transitions to `cancelled`.
- [ ] Typecheck + tests pass.

---

### Task 4: SSRF allowlist on `pdfUrl`

**Why:** `startExtraction` accepts `sourceManualItems[].pdfUrl` with no validation. It flows into `lib/pdf/download.ts` where `fetch(url, { redirect: "follow" })` runs against whatever the user passes. Attacker points it at `http://169.254.169.254/latest/meta-data/` (AWS metadata), `http://localhost`, RFC1918 ranges, or `file://`. Errors surface back to the caller — making it a network oracle.

**Files & lines:**

- `convex/extraction/mutations.ts:150-162` — `sourceManualItems.pdfUrl` validator
- `lib/pdf/download.ts:73-76, 382, 423-426` — the raw `fetch` sites

**Target behavior:** a new `lib/pdf/url-allowlist.ts` module with a `safeFetchPdf(url, { maxBytes })` helper that:

1. Parses URL; rejects if scheme is not `https:` (reject `http`, `file:`, `data:`, `ftp:`, everything else).
2. Rejects userinfo (`user:pass@`) in authority.
3. Resolves DNS. Rejects if any A/AAAA record is in:
   - loopback (`127.0.0.0/8`, `::1`)
   - link-local (`169.254.0.0/16`, `fe80::/10`)
   - private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`)
   - metadata endpoints (`169.254.169.254`, `fd00:ec2::254`)
   - multicast + unspecified
4. Follows up to 5 redirects MANUALLY (not via fetch's `redirect: "follow"`), re-validating each hop.
5. Caps response body at `maxBytes` (e.g. 50 MB for PDFs) to prevent zip-bomb / unbounded reads.
6. Returns sanitized error messages ("PDF download failed") — do not leak target host / status code back to user.

Replace every `fetch(` in `lib/pdf/download.ts` that uses a user-supplied URL with `safeFetchPdf`. Leave system-controlled fetches (OpenAlex API) alone — they go through `lib/openalex/` and hit a known host.

Also clamp `pdfUrl` validator length to 2048 chars at the mutation boundary (`convex/extraction/mutations.ts:150-162`).

**Acceptance:**

- [ ] Unit test in `lib/pdf/url-allowlist.test.ts`: reject `http://`, `file://`, `169.254.169.254`, `127.0.0.1`, `localhost`, `10.0.0.1`, `fd00::1`. Accept a public https URL (mock DNS).
- [ ] Redirect chain test: first hop public, second hop private — rejected at second hop.
- [ ] Integration test: submit a job with a disallowed `pdfUrl`, assert paper ends `download_failed` with generic error.
- [ ] `grep -n "redirect: \"follow\"" lib/pdf/download.ts` returns empty.

**Library note:** there is likely a DNS-resolution helper already in the codebase — search for it before writing a new one.

---

### Task 5: Cap unbounded input arrays

**Why:** `startExtraction` accepts `questions`, `sourceManualItems`, `sourceZoteroSelection.items` with no length validation. A single call can queue a 10k-question × 500-paper job and drain the account's credits and the system's workpool capacity.

**Files & lines:** `convex/extraction/mutations.ts:123-176`

**Target behavior (pick sensible caps — adjust via product review later):**

| Field | Cap |
|---|---|
| `questions` | 50 |
| `sourceManualItems` | 1000 |
| `sourceZoteroSelection.items` | 1000 |
| `sourceHistoryEntries` | 20 |
| `questions[i].question` string | 2000 chars |
| `sourceManualItems[i].title` string | 500 chars |
| `sourceManualItems[i].abstract` string | 10000 chars |
| `sourceManualItems[i].pdfUrl` string | 2048 chars |

Enforce in the `args:` validator (Convex doesn't have native `v.array(v.x).max(n)` — add a manual length check at the top of the handler and throw `createError("VALIDATION_ERROR", …)`). Pull the caps into `convex/extraction/validators.ts` as named constants so they're discoverable.

**Acceptance:**

- [ ] New constants `MAX_QUESTIONS_PER_JOB`, `MAX_MANUAL_ITEMS_PER_JOB`, etc. in `convex/extraction/validators.ts`.
- [ ] Test: submit a job with `questions.length > MAX_QUESTIONS_PER_JOB` — rejected with `VALIDATION_ERROR`.
- [ ] Test: submit a job with one question containing a 3000-char string — rejected.
- [ ] Typecheck + tests pass.

---

### Task 6: Idempotent credit deduction (embedding + LLM)

**Why:** On a workpool retry, the paper re-runs: embedding credits are deducted again (`workpoolActions.ts:871-896`), and LLM credits are deducted again inside `withUserCreditsBatch` (`workpoolActions.ts:990`). A transient failure after billing → customer charged twice.

**Files & lines:**

- `convex/extraction/workpoolActions.ts:871-896` — embedding deduction
- `convex/extraction/workpoolActions.ts:990` — LLM deduction via `withUserCreditsBatch`
- `convex/schema.ts` — `extractionPapers` table (add flags)
- `convex/extraction/mutations.ts:2098` — `saveExtractionResultsAndComplete`

**Target behavior:**

1. Add `indexingBilled: v.optional(v.boolean())` and `extractionBilled: v.optional(v.boolean())` to `extractionPapers` schema.
2. **Embedding gate:** at the top of the embedding path, if `paper.isIndexed === true` OR `paper.indexingBilled === true` → skip embedding and skip deduction. After a successful embed, within the same mutation that flips `isIndexed = true`, also set `indexingBilled = true`.
3. **LLM gate:** refactor LLM billing out of `waitAndExtractAction`. Instead, run LLM calls → return results → `saveExtractionResultsAndComplete` mutation checks `paper.extractionBilled`, deducts credits, and sets `extractionBilled = true` atomically with persisting results. One transaction = one charge.
4. If `saveExtractionResultsAndComplete` retries (Convex auto-retries mutations on OCC conflict), the gate still holds because the first successful commit sets the flag.

**Acceptance:**

- [ ] Test: simulate a successful embed then force a retry — credit ledger shows one deduction only.
- [ ] Test: simulate a successful LLM extract then force a retry of `saveExtractionResultsAndComplete` — credit ledger shows one deduction only.
- [ ] `grep -n "withUserCreditsBatch" convex/extraction/workpoolActions.ts` returns empty (billing moved to mutation).
- [ ] Typecheck + tests pass.

**Reference:** the credits module is `convex/credits/` — read `convex/credits/deduct-credits.test.ts` to see how deductions are tested.

---

### Task 7: Delete `getCurrentUserInternal` auth-bypass wrapper

**Why:** `convex/extraction/queries.ts:1648` exposes a wrapper that uses `identity.subject` and skips the active-user check. The Convex guidelines explicitly require `tokenIdentifier`, and the canonical helper in `lib/auth.ts` does it right.

**Files & lines:**

- `convex/extraction/queries.ts:1648` — delete the function
- `lib/auth.ts` — the canonical `getCurrentUser` helper (check it exists; if not, use whatever pattern `convex/library/queries.ts` or `convex/screening/queries.ts` uses)
- grep callers: `grep -rn "getCurrentUserInternal" --include="*.ts" .`

**Target behavior:**

1. Remove the export in `queries.ts:1648`.
2. Remove the re-export in `convex/extraction/index.ts` if present.
3. Route every caller to the canonical helper.

**Acceptance:**

- [ ] `grep -rn "getCurrentUserInternal" --include="*.ts" .` returns empty.
- [ ] Every former caller uses `tokenIdentifier` for ownership lookups.
- [ ] Typecheck + tests pass.

---

### Task 8: Register `cleanupOldPdfs` cron

**Why:** The mutation exists at `convex/extraction/mutations.ts:1577` but is never scheduled in `convex/crons.ts`. Result: PDFs stored during extraction never expire, storage bill grows forever.

**Files & lines:**

- `convex/crons.ts` — add the cron (see existing patterns in this file)
- `convex/extraction/mutations.ts:1577` — verify the mutation is an `internalMutation` and paginates safely (it MUST use `take(n) + scheduler.runAfter(0, ...)` for bulk delete per Convex guidelines)

**Target behavior:**

```ts
crons.interval(
  "cleanup old extraction pdfs",
  { hours: 24 },
  internal.extraction.mutations.cleanupOldPdfs,
  {}
);
```

Verify `cleanupOldPdfs` is actually safe at scale — if it does `.collect()` on unbounded queries, fix that while you're here (this is technically P1 but it's a 5-line fix while you're in the file).

**Acceptance:**

- [ ] `convex dev` picks up the cron without errors.
- [ ] Test: seed 10 PDFs with creation time >30 days ago, run the mutation manually via `t.action`, assert all 10 deleted from storage + referenced rows cleaned.
- [ ] Typecheck + tests pass.

---

## 5. Definition of done (whole plan)

- [ ] All 8 tasks merged, each as its own atomic commit.
- [ ] `npx convex typecheck` clean on the final state.
- [ ] `npm test` green (including new tests added per task).
- [ ] `npm run lint` clean.
- [ ] No files added outside of what was necessary; no "legacy" shims.
- [ ] Manual smoke test: start an extraction, let one paper finish, cancel the job, verify it stays cancelled. Start a parallel job as a different test user, verify it is unaffected.
- [ ] Dev dashboard: no PDFs older than 30 days after cleanup cron runs once.

---

## 6. Agent operating notes

- **Commit granularity.** One task = one commit. Commit messages: `extraction: <concise imperative>` (matches repo style — verify with `git log --oneline | head -20`).
- **Before each task**, re-read the cited file:line range — the numbers in this plan may drift as you edit.
- **Do not start a task if its predecessor is failing tests.**
- **Ask nothing.** If you genuinely can't proceed, write a note in `.agents/audit/plans/BLOCKERS.md` and move to the next task.
- **DRY reminder.** When adding helpers (URL allowlist, cascade-cancel), check `lib/` first. The repo has extensive utilities; find them with `grep -rl`.
- **The schema migration for `workId` / `indexingBilled` / `extractionBilled` is trivial** — this is pre-release, no data loss concern.

---

## 7. Related reports (full context)

- `.agents/audit/00-CONSOLIDATED.md` — overview
- `.agents/audit/01-security.md` — full SSRF/auth/DoS details
- `.agents/audit/02-bugs.md` — finalize + cancel + double-fire bugs
- `.agents/audit/03-performance.md` — (mostly P1 territory, but idempotency overlap)
- `.agents/audit/04-convex-best-practices.md` — guideline violations
- `.agents/audit/06-dataflow.md` — pipeline map + billing idempotency narrative
