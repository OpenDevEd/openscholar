# Security Audit: Extraction Pipeline

**Scope:** `convex/extraction/` (32 files) plus supporting helpers in `convex/lib/`, `convex/featureFlags/`, `convex/workpool.ts`, and `lib/pdf/download.ts`.
**Auditor focus:** AuthZ, input validation, secrets, SSRF, injection, TOCTOU, DoS, debug endpoints, plan/feature gates.

## Summary

The extraction pipeline has a **generally strong authorization posture**: every public mutation/query resolves the caller via `requireAuth`/`getCurrentUser`, verifies job ownership through `assertJobOwnership`/`resolveOwnedJob`, and all diagnostic entry points are `internalQuery`/`internalAction`. Feature flags (`extraction.enabled`, `extraction.start`, `extraction.pdf`, `extraction.insights`, `extraction.reportBuilder`, `extraction.reviewQueue`, `extraction.templates`) are enforced **server-side**, not just in UI. Rate limiting is applied to `startExtraction`, `duplicateExtraction`, and `startExtractionFromTemplate`.

The **most severe concern** is a **server-side request forgery (SSRF)** primitive exposed by `startExtraction`: a user-supplied `sourceManualItems[].pdfUrl` flows through the workflow into `downloadPdf` / `fetchPdfWithRetry` with `redirect: "follow"` and no scheme/host/IP allowlist. An authenticated user can use the Convex backend as a general-purpose HTTP proxy into internal metadata services or private networks (subject to Convex sandboxing, which is provider-dependent and NOT documented to block RFC1918 or link-local ranges). Secondary high-severity issues include unbounded input arrays, global cross-tenant cancellation in `cancelExtraction`, and prompt-injection primitives via user-controlled question text.

## Critical

### C1. SSRF via user-controlled `pdfUrl` in manual source items
- **Attack vector:** authenticated user calls `startExtraction` (or `duplicateExtraction`, `startExtractionFromTemplate`, `saveWorkflowTemplate`) with `sourceManualItems: [{ id: "x", title: "t", pdfUrl: "http://169.254.169.254/latest/meta-data/..." }]`.
- **Flow:**
  - Argument accepted, unvalidated: `convex/extraction/mutations.ts:150-162` (`sourceManualItems.pdfUrl: v.optional(v.string())`).
  - Stored on the job: `convex/extraction/mutations.ts:199`.
  - Workflow enqueues it verbatim: `convex/extraction/workflow.ts:119-133` then `convex/extraction/workflow.ts:218-230` (`pdfUrl: paper.pdfUrl || ""`).
  - Workpool action calls `resolvePdfBlob`: `convex/extraction/workpoolActions.ts:742` → `downloadPdf(args.pdfUrl, ...)`.
  - `downloadPdf` dispatches to `fetchPdfWithRetry`: `lib/pdf/download.ts:73-76` → `lib/pdf/download.ts:364-408`.
  - Raw `fetch(url, { redirect: "follow" })` with no URL validation: `lib/pdf/download.ts:382` and `lib/pdf/download.ts:423-426`.
  - Additional fanout: when a DOI is provided, `fetchAlternativeOaUrls(doi)` (`lib/pdf/download.ts:63-70`) fetches Unpaywall URLs which are also blindly fetched; and `extractPdfUrlFromHtml` (`lib/pdf/download.ts:438+`) parses HTML and follows discovered `citation_pdf_url` / `<meta refresh>` / anchor targets with no revalidation before a second `fetch`.
- **Impact:**
  - Scan/probe internal services reachable from the Convex worker (cloud metadata endpoints `169.254.169.254`, `localhost:*`, RFC1918 ranges, `file://`-like via redirect bounce through HTTP→HTTPS-wrapped schemes if provider tolerates it).
  - Exfiltrate internal responses: errors from `downloadPdf` surface verbatim to the user via `paper.pdfDownloadError` (see `convex/extraction/mutations.ts:1420+` → stored on `extractionPapers.pdfDownloadError`, read back by `getPapersForJob` queries). Even a 403/HTTP status code message leaks presence/absence of an internal endpoint.
  - Amplification: each call can loop through EuropePMC (`lib/pdf/download.ts:51-59`) + top-3 alt OA URLs + the original URL, with 3 retries each, before surfacing failure. Up to ~15 outbound fetches per malicious item; `startExtraction` accepts an unbounded `sourceManualItems` array (see H1).
- **Remediation:**
  1. At mutation time, validate `pdfUrl` with a strict allowlist: `https:` only, reject any host that resolves to a private / link-local / loopback / unique-local / multicast IP, reject raw IP hosts, cap URL length.
  2. Inside `fetchPdfWithRetry`, resolve the host via DNS before fetching and block private ranges; disallow redirects that change host class (`redirect: "manual"` and reject `3xx` Location headers pointing into private space).
  3. Do not propagate raw fetch errors to user-facing fields; map to a generic "PDF unavailable" message.
  4. Sandbox outbound fetches through a dedicated fetch helper with a host allowlist (OpenAlex, EuropePMC, Unpaywall, known journal domains) or a signed-URL proxy.

## High

### H1. Unbounded input arrays on `startExtraction`
- `convex/extraction/mutations.ts:123-163`: `sourceHistoryEntries`, `sourceZoteroSelection.items`, `sourceManualItems`, `questions` are all `v.array(...)` with **no maximum length** and no string-length caps. An authenticated caller can submit arbitrarily large payloads (within Convex argument size limits ~16 MB).
- `convex/extraction/mutations.ts:164-176`: `questions[].question` / `questions[].description` are unbounded strings; these are persisted (`convex/extraction/mutations.ts:210-220`) and later interpolated into LLM prompts.
- No write-side guard enforces the read-side `MAX_EXTRACTION_JOBS_PER_USER = 500` or `MAX_REVIEWS_PER_JOB = 10_000` defined in `convex/lib/queryBounds.ts:11-19`.
- **Impact:** DoS via large job payloads, runaway token spend (each question is dispatched per paper through the AI pipeline), and storage growth. Paired with SSRF (C1), this multiplies the number of outbound requests per job.
- **Remediation:** enforce `args.questions.length <= N` (e.g. 50), `args.sourceManualItems.length <= M` (e.g. 500), `args.sourceZoteroSelection.items.length <= M`, string-length caps on question/description/title/abstract, and count active jobs per user before inserting (respect `MAX_EXTRACTION_JOBS_PER_USER`).

### H2. Global cross-tenant cancellation in `cancelExtraction`
- `convex/extraction/mutations.ts:278-282`:
  ```
  await pdfProcessingPool.cancelAll(ctx);
  ```
- The comment at `convex/extraction/mutations.ts:274-277` acknowledges that `cancelAll()` cancels ALL pending workpool items across **all** jobs and **all** users. It relies on credit-guard re-checks inside the workpool actions to avoid mis-billing, but the side effect is that **any authenticated user who owns one cancellable job can degrade service for every other tenant's in-flight extractions** (the pool will be re-driven, but papers currently mid-processing are aborted and re-queued).
- **Impact:** Cross-tenant DoS / noisy-neighbor attack. Low sophistication — call `startExtraction` then `cancelExtraction` in a loop within rate-limit bounds (5/hr).
- **Remediation:** track workpool work IDs per job (schema field `extractionPapers.workId` already exists, `convex/extraction/mutations.ts:1501`) and iterate `pdfProcessingPool.cancel(ctx, workId)` for only this job's papers. Remove `cancelAll`.

### H3. Zotero `pdfUrl` constructed from user-submitted `itemKey` / `groupId`
- `convex/extraction/workflow.ts:94-101`:
  ```
  const uri = libraryType === "group" && groupId
    ? `zotero://select/groups/${groupId}/items/${item.itemKey}`
    : zoteroUserId
      ? `zotero://select/users/${zoteroUserId}/items/${item.itemKey}`
      : undefined;
  ```
- `itemKey` and `groupId` come from the client `startExtraction` args (`convex/extraction/mutations.ts:131-148`) with no validation. The Zotero branch of `downloadPdf` (`lib/pdf/download.ts:46-48`) dispatches based on the `zotero://` prefix, but the downstream Zotero API call can be induced to hit arbitrary group IDs with the caller's **decrypted Zotero API key** (`convex/extraction/workpoolActions.ts:724-734`), enabling a user to probe or (with a compromised client) exfiltrate attachments from unrelated Zotero groups the user is a member of but did not intend to expose. The API key itself is correctly AES-GCM-encrypted at rest (`convex/lib/crypto.ts`).
- **Remediation:** validate `itemKey` against `/^[A-Z0-9]{8}$/`, `groupId` against `/^\d+$/`, and cross-check that the job's Zotero selection's `groupId` / `libraryType` matches the stored Zotero connection.

## Medium

### M1. Prompt injection via user-controlled question text
- `convex/extraction/prompts.ts:72-78`:
  ```
  prompt += `EXTRACTION TASK:
  Question: ${question.question}
  `;
  if (question.description) {
    prompt += `Additional Context: ${question.description}\n`;
  }
  ```
- `question.question` and `question.description` flow unchanged from `startExtraction` args (`convex/extraction/mutations.ts:164-176`) into the LLM prompt. A crafted question can override the "Return strict JSON" instruction, request evidence fabrication, or embed payloads that shift outputs toward attacker-controlled answers.
- Persisted verbatim (`convex/extraction/mutations.ts:210-220`; schema `convex/schema.ts:409-424`) and reused in templates (`convex/extraction/mutations.ts:690-702`) and report-builder output (`convex/extraction/mutations.ts:830-843` builds `keyFindingsLines` from `row.question.question`).
- **Impact:** incorrect extractions, fabricated citations, cross-run contamination when templates are shared. No privilege escalation but violates integrity of extraction results and can be used to bypass answer-grounding checks.
- **Remediation:** strip control characters, enforce max length (e.g. 500 chars), and delimit user content in the prompt with explicit non-user-overridable fences (e.g. `<user_question>...</user_question>` guarded by a post-prompt reassertion of the JSON contract, plus rejection of questions containing instruction keywords like "ignore previous").

### M2. Verbose error message propagation from internal services to user
- `convex/extraction/workpoolActions.ts:155-169` `toErrorMessage` returns the raw `error.data.message` / `error.message` from downstream services.
- These strings are written into `extractionPapers.pdfDownloadError` / `errorMessage` (`convex/extraction/mutations.ts:1420+`, `convex/extraction/workpoolActions.ts:978-986`) and displayed via `convex/extraction/queries.ts` in `getPapersForJob`, `diagnoseJob`, etc.
- Combined with C1, this turns the PDF fetcher into an oracle for internal network presence (e.g. `connect ECONNREFUSED 169.254.169.254:80`, `getaddrinfo ENOTFOUND internal.svc`).
- **Remediation:** map downstream errors to a small set of generic, stable error codes before persisting (e.g. `"DOWNLOAD_FAILED"`, `"SOURCE_UNREACHABLE"`) and keep verbose detail only in server logs.

### M3. Guideline violation: `identity.subject` used instead of `identity.tokenIdentifier`
- `convex/_generated/ai/guidelines.md:179` mandates preferring `identity.tokenIdentifier` as the canonical identity key; `identity.subject` alone is discouraged.
- Offending sites touching extraction:
  - `convex/lib/auth.ts:37,54,72,81` (central auth helpers used by all extraction public endpoints).
  - `convex/extraction/queries.ts:1656` (`getCurrentUserInternal`).
- **Impact (current, this codebase):** with Clerk as the sole IdP, `subject = sub` is stable per user, so **exploitability today is low**. However, mixing providers or re-binding a Clerk user could allow reuse of a stale `clerkId` → wrong user. This is the kind of regression that only surfaces after an IdP change.
- **Remediation:** migrate the `by_clerk_id` index to store and look up `tokenIdentifier`, or add a parallel `by_token_identifier` index and use it in `requireAuth`/`getCurrentUser`.

### M4. PDF content flows into `ai.generateText` with structured output — no per-paper budget on prompt size
- `convex/extraction/workpoolActions.ts` composes prompts from arbitrary PDF text via `buildChunkedEvidenceUnitsFromPdfPages` and then calls `generateText(... Output.object(...) ...)` per question. There is no cap on total prompt tokens per paper visible in the workpool action beyond the RAG top-K retrieval constants (`DENSE_LIMIT = 120`, `FUSED_TOP_N = 48`, `EVIDENCE_POOL_N = 16` at `convex/extraction/workpoolActions.ts:104-108`). A malicious large PDF (uploaded via the extraction upload URL, which is feature-gated but otherwise size-ungated — see `convex/extraction/uploads.ts:6-15`) can force maximum-token LLM calls per question per paper.
- **Impact:** credit drain, slow queue heads-of-line on the workpool.
- **Remediation:** enforce a max bytes per upload in `generateUploadUrl` (or at `ctx.storage.store` post-download in `resolvePdfBlob`), and cap `evidence.length` handed to the prompt to a fixed token budget.

## Low

### L1. `startExtraction` persists job + questions before workflow kickoff — race on workflow cancellation
- `convex/extraction/mutations.ts:192-234` inserts the job, writes all questions, then calls `workflow.start`. If the mutation aborts between inserts 1 and N the partially-written job is orphaned in `pending` until `cancelExtraction` / `deleteExtraction`. No TOCTOU privilege escalation — purely a cleanup concern.
- **Remediation:** acceptable for now; `finalizeJobIfDone` + `deleteExtraction` already reap. Consider inserting questions in a single `Promise.all` or marking the job `pending_setup` until post-`workflow.start`.

### L2. `deleteExtraction` storage cleanup best-effort
- `convex/extraction/mutations.ts:1113-1120` deletes `_storage` blobs inside the cascade loop with `try/catch` that only logs. On repeated failures the blobs leak.
- **Remediation:** enqueue an idempotent storage cleanup task and retry.

### L3. Debug/internal test entry points exist in the deployed bundle
- `convex/extraction/test_runner.ts`, `convex/extraction/testActions.ts`, `convex/extraction/create_test_job.ts`, `convex/extraction/test_automation_internal.ts` are all declared as `internal*` — not directly callable by clients. `test_runner.ts`'s `createAndRunTestJob` picks the first user in the DB as the actor, which is dangerous if any other internal action or a future scheduler hook wraps it.
- **Remediation:** gate the test-only modules behind a dev-only build flag or ship them only in non-production Convex deployments.

### L4. `OPENALEX_CONTACT_EMAIL` / `ENCRYPTION_KEY` required only at runtime
- `convex/extraction/actions.ts:139-143` correctly throws if `OPENALEX_CONTACT_EMAIL` is missing.
- `convex/extraction/workpoolActions.ts:727-729` correctly throws if `ENCRYPTION_KEY` is missing.
- Absence is detected only when extraction runs, not at deploy time. A misconfigured deployment will accept `startExtraction` calls, consume the rate-limit budget, and only fail inside the workpool (credits already reserved via credit-guard pathway, though `withUserCreditsBatch` does refund on throw).
- **Remediation:** add a startup self-test internal cron that validates required env vars.

### L5. `pdfProcessingPool.cancelAll` fallback inside `cancelExtraction` may still consume credits for papers that advanced past the credit check
- The in-code comment (`convex/extraction/mutations.ts:274-277`) notes credit guards, but the guard is on the action entry; a paper whose extraction has already started will still consume the LLM call. This is a documented known-issue.

## Positive observations

- **AuthZ is consistently applied on every public mutation and query** via `requireAuth` / `assertJobOwnership` / `resolveOwnedJob`:
  - `convex/extraction/mutations.ts:181,245,293,391,398,458,527-528,569,574,590-592,752,779-781,988-990,1044-1047` — every `mutation({ ... })` handler begins with `requireAuth` and explicit ownership check.
  - `convex/extraction/queries.ts:69-101` — centralized `resolveOwnedJob` / `resolveOwnedPaper` helpers returning `unauthenticated | no_access | ok` status objects used uniformly.
- **All debug/diagnostic endpoints are `internalQuery` / `internalAction`** (confirmed via `convex/extraction/index.ts` exports and grep: `diagnoseJob`, `getFailedPapersDebug`, `debugPaperResults`, `getCurrentUserInternal`, `backfillJobStats`, `cleanupFailedPaperStorage`, `cleanupOldPdfs` are all `internal*`).
- **Feature flag enforcement is server-side** and not merely UI: `convex/extraction/mutations.ts:180,182,292,294,457,459,589,591,706,708,778,780,987`; `convex/extraction/queries.ts:701,937,1056,1199,1370`; `convex/extraction/uploads.ts:10-12`. Client-side gates in `components/extraction/extraction-access-gate.tsx` / `extraction-plan-gate.tsx` are strictly UX.
- **Rate limiting** on the three entry points that can start work: `convex/lib/rateLimit.ts:18-23` defines `start-extraction` as 5/hr with bucket capacity 3, consumed at `convex/extraction/mutations.ts:183-187,295-299,460-464`. The `consume` internalMutation pattern is correct for action callers.
- **Zotero API keys are AES-256-GCM encrypted at rest**, decrypted only in-memory inside the workpool action with an audit log written (`convex/extraction/workpoolActions.ts:724-739`; `convex/lib/crypto.ts`).
- **OpenAlex contact email is required**: `convex/extraction/actions.ts:138-143` fails loudly instead of silently hitting the anonymous throttle tier.
- **Input validators are specific**: `convex/extraction/validators.ts` uses precise `v.union`/`v.object` shapes; no `v.any()` found in the public extraction surface. `answerValidator` and `statusResultValidator` have explicit discriminated unions.
- **Per-query safety bounds** for read-side scans: `MAX_PAPERS_PER_JOB = 500` (`convex/extraction/queries.ts:53`), `MAX_EVIDENCE_UNITS_PER_PAPER`, `MAX_REVIEWS_PER_JOB` (`convex/lib/queryBounds.ts:11-19`).
- **Cascade delete is paginated** via `ctx.scheduler.runAfter(0, ...)` self-recursion (`convex/extraction/mutations.ts:1058-1200`), respecting Convex transaction limits.
- **`generateUploadUrl` requires auth + feature flag** before minting a storage upload URL (`convex/extraction/uploads.ts:6-15`) — not a wide-open upload.
- **Workpool `onComplete` handlers** use Convex's guarantee of post-run callback instead of racy polling (`convex/extraction/mutations.ts:1834,1907,1951`).
