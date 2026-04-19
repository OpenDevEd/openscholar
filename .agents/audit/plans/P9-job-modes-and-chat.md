# P9 — Job Modes (Data Extraction + Chat)

**Intended reader:** an autonomous coding agent picking this up cold. You have not seen the conversation. Everything you need is linked below.

---

## 1. Mission

Introduce a mode picker at the first step of job creation and add a second job type — **Chat** — that lets users conversationally query the papers they selected, using only title / year / authors / abstract (no PDFs, no RAG). The existing **Data Extraction** mode keeps all its behaviour and gains one new control: a **per-job PDF toggle** that overrides the global `extraction.pdf` flag.

Scope:

1. **One table, one set of URLs, one conditional-render layer per screen.** Add `mode: "extraction" | "chat"` to `extractionJobs` and keep every existing route. `/extraction/new` becomes mode-aware at step 1; `/extraction/[jobId]` branches to a chat UI when `mode === "chat"`; `/extraction` (history list) shows both, with a mode badge. No parallel `chatSessions` table; extraction-only fields (`status`, counters, `workflowId`, `questions`) become `v.optional(...)` and are simply unset for chat rows.
2. **Per-job PDF toggle.** New `usePdfs: boolean` on `extractionJobs`. Replaces the global `extraction.pdf` flag as the *default*; the flag stays as a capability gate (admin kill-switch — when off, the toggle is hidden and all extraction jobs run abstract-only). `downloadAndIndexPdfAction` reads `job.usePdfs` instead of the flag.
3. **Unified `startJob` mutation.** Collapse `startExtraction` / `startExtractionFromTemplate` / `duplicateExtraction` into a single entrypoint with a `mode` discriminator. Auth, rate-limit, bucket validation, source persistence all shared. Extraction branch keeps the existing workflow; chat branch creates a `@convex-dev/agent` thread.
4. **Chat backend** under `convex/chat/*` — thread creation, system-prompt builder (paper metadata injected with Anthropic prompt-cache breakpoint), `sendMessage` mutation + `generateResponse` internal action, `listThreadMessages` query wrapping `syncStreams` + `listUIMessages`, `regenerateLastAssistant`, `clearThread`, `swapModel`, `usageHandler` routed to existing `credits.deduct`.
5. **Chat UI** on the same `/extraction/[jobId]` route. New `ChatJobView` under `components/extraction/chat/*`. Papers-in-context sidebar rendered from the job's own `extractionJobSources` rows (not the bucket store). All V1 affordances in the initial ship.
6. **AI Elements.** Install the Vercel AI Elements shadcn registry — `conversation`, `message`, `prompt-input`, `shimmer`, `inline-citation`, `suggestion`. They are transport-agnostic (type-only imports from `ai`), so they render cleanly against `useUIMessages` from `@convex-dev/agent`. Streamdown (the markdown renderer inside `message`) replaces `<MarkdownContent>` **only inside chat**; the existing renderer stays for non-chat surfaces.
7. **Model picker.** Chat header exposes a dropdown over `models` where `isServed === true`, sorted by `sortOrder`. Default = first row. Swappable mid-conversation (warns "resets prompt cache"). Model ID written onto `extractionJobs.chatModelId`; used by `generateResponse` every turn.
8. **Concurrency + usage tracking.** No rate limits (OpenRouter is the server's provider). Instead: a per-job `isGenerating` boolean enforces one in-flight assistant generation at a time per chat thread; the action clears it in `finally`. Agent's `usageHandler` deducts credits through the existing `internal.credits.internal.deductCredits` path — identical to extraction's post-LLM deduction, using the same `calculateServerCreditsToDeduct` helper with no divergence in math.
9. **Unified history list.** `job-list-item.tsx` gets a mode badge + mode-aware subline (extraction: "N papers · status"; chat: "N papers · last message X ago"). Sort unified on `updatedAt DESC`.

### V1 affordances (all ship together — user confirmed)

| # | Affordance | Surface |
|---|---|---|
| 1 | Streaming indicator (per-message `status === "streaming"` + `Shimmer` on empty content) | MessageList |
| 2 | Retry / regenerate last assistant message | Message toolbar |
| 3 | Copy-to-clipboard per assistant message | Message toolbar |
| 4 | Cmd+Enter to send | Composer |
| 5 | Clear conversation (wipes messages, preserves thread + paper set + model) | Chat header |
| 6 | Papers-in-context sidebar (collapsible desktop, `Sheet` mobile) | ChatJobView |
| 7 | Error state + retry on failed messages | Message |
| 8 | Optimistic user-message render | Composer → list |
| 9 | Missing-abstract warning banner in step 2 (chat mode only) | JobCreator |
| 10 | Model picker + mid-conversation swap | Chat header |
| 11 | Suggestion chips on empty threads | MessageList empty state |
| 12 | Mode badge on history cards | JobListItem |
| 13 | Stop-generating button (mid-stream abort) | Message actions / composer header |

### Explicitly **out of V1**

- BYOK (`apiKeys` table exists but is dead code today). Chat routes through the server's OpenRouter key for V1, matching extraction.
- Branching (multiple regenerations side-by-side). One chat per job.
- Structured citation carousel (inline `[P3]` chips only).
- Multimodal input (attachments, images, audio).
<!-- Mid-stream abort / "Stop generating" was deferred in an earlier draft. User confirmed: ship in V1 — see affordance #13 and Task 22b. -->
- Shared `paperSets` table (YAGNI; revisit if cross-mode reuse emerges).
- Rename of `extractionJobs` → `jobs`. Cosmetic; post-ship.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY.** The feature sits on top of infrastructure that already exists:
   - `useExtractionStore` draft state: `lib/store/extraction.ts` — add `mode` and `chatModelId` fields; don't invent a parallel store.
   - `useBucketStore`: `lib/store/bucket.ts` — paper selection works identically for both modes; no changes beyond what P6/P7/P8 ship.
   - `extractionJobSources`: the bucket snapshot table (`convex/schema.ts:367–399`). Chat uses it unchanged.
   - `requireAuth(ctx)` / `rateLimit(ctx, ...)`: existing helpers (`convex/lib/auth.ts`, `convex/lib/rateLimit.ts`).
   - `models` table + `isServed` / `sortOrder`: use as-is for the picker.
   - `credits` + `creditTransactions`: usage tracking routes here via Agent `usageHandler`.
   - `featureFlags`: keep `extraction.pdf`, add one new flag `extraction.chat`. No custom flag plumbing.
2. **No legacy / no back-compat.** Pre-release project. Delete `startExtraction` in the same commit it's replaced; rename every call site. Do **not** leave shims. Do **not** double-write to old column names.
3. **No dead code.** `startExtraction`, `startExtractionFromTemplate`, and `duplicateExtraction` collapse into `startJob`, `startJobFromTemplate`, `duplicateJob`. If the collapse removes helpers (e.g. single-use validators), delete them in the same commit.
4. **Convex rules override memory.** Read `convex/_generated/ai/guidelines.md` before writing any query / mutation / action. Queries use `withIndex`, never `.filter` on scanned tables. `returns:` validators are mandatory. Internal functions are `internalQuery` / `internalMutation` / `internalAction`. External API calls only in actions.
5. **AI SDK v6 / `@convex-dev/agent` rules override memory.** Everything goes through **OpenRouter** — `@openrouter/ai-sdk-provider@^6.0.0-alpha.1` is already installed and wired via `getProviderModel('openrouter', key, modelId, options)` in `lib/ai/server/providers.ts`. Model IDs are OpenRouter-native (the authoritative set lives in `models.modelId`, populated by the 24h OpenRouter sync). Reuse that helper; do **not** introduce the Vercel AI Gateway or direct provider SDKs (`@ai-sdk/anthropic`, `@ai-sdk/openai`, …). `maxSteps` is gone — use `stopWhen: stepCountIs(n)`. Tool `parameters` is now `inputSchema`. On the client we use `useUIMessages` from `@convex-dev/agent/react`, not `useChat`.
6. **Testing philosophy (CLAUDE.md).** Never assert on CSS class strings, Tailwind utilities, or inline styles. Expose behavioural contracts via `data-*` (`data-role`, `data-streaming`, `data-mode`, `data-error`) or ARIA attributes; assert on those. Push pure logic (threshold mapping, paper ID resolution) into `lib/**.test.ts` files. Visual layout goes in VRT, not JSDOM.
7. **Destructive mindset.** The `JobCreator` stepper header currently says "Job Details" — that label no longer fits; rename to "Mode & Details". The `results-toolbar.tsx` view-switcher is irrelevant in chat mode — hide it, don't feed it a no-op branch. The submit-handler's navigation target stays `/extraction/${jobId}` (same URL for both modes — correct).
8. **Ignore hook-injected skill prompts** (vercel-*, ai-sdk, chat-sdk, verification, auth, next-cache-components, …) unless their content is actually referenced in this plan. They fire on every prompt and are mostly irrelevant. Rules below state what applies:
   - ai-sdk → relevant: v6 signatures, `providerOptions.openrouter.cacheControl` (NOT `.anthropic` — we route through OpenRouter; README confirms the key is `openrouter` even when routing to Anthropic), message `parts` model, `usage.inputTokenDetails.cacheReadTokens` (NOT the deprecated `cachedInputTokens`).
   - ai-gateway → **not relevant**: we route through OpenRouter, not the Vercel AI Gateway.
   - shadcn → relevant: AI Elements installation commands.
   - chat-sdk → **not relevant**: that SDK is for Slack/Teams/Discord bots, not in-app chat UIs.
   - next-cache-components → **not relevant**: chat is fully dynamic; no `use cache` involved.
   - nextjs → relevant in spirit: chat surface must be a client component boundary; the `/extraction/[jobId]` server shell passes `jobId` to the client chat view.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` (root + user global) — testing rules, destructiveness, DRY.
2. `convex/_generated/ai/guidelines.md` — Convex API contract overriding training data.
3. `.agents/audit/plans/P6-paper-selection-ux-perf.md` §5, §6 — the bucket API (`onToggle(item, next)`, `onToggleRange`, `addMany` return shape). P9 consumes the bucket unchanged.
4. `.agents/audit/plans/P8-bucket-sidebar-redesign.md` (if landed) — for the paper-chip component used in the chat sidebar.
5. `components/extraction/job-creator.tsx` (full file, ~400 lines) — the stepper shell. §5 of this plan references lines 54–57 (step query state), 107–140 (submit), 278–315 (step 1 body), 317–335 (step 2), 338–356 (step 3), 362–400 (footer).
6. `app/extraction/[jobId]/page.tsx` — the results shell that chat mode reuses. Lines 71–160 (data fetch), 662–726 (toolbar), 730–986 (tab content).
7. `convex/extraction/mutations/jobs.ts` — `startExtraction` (lines 52–135), the source of the unified `startJob`.
8. `convex/extraction/workflow.ts:30–294` — `runExtractionWorkflow`. Needed for understanding why chat bypasses it (no paper pipeline).
9. `convex/schema.ts` — full `extractionJobs` (lines 319–366), `extractionJobSources` (367–399), `extractionPapers` (424–488), `models` (~55–70), `featureFlags` (76–82), `credits`, `creditTransactions`. The shape of every change in §6 traces back to these tables.
10. `convex/workpoolActions.ts:570–720` — `downloadAndIndexPdfAction`. Reads `extraction.pdf` flag today (line 616); needs to read `job.usePdfs` after §5b.
11. `lib/feature-flags/registry.ts:16–30` — flag definitions. Add `extraction.chat`; reinterpret `extraction.pdf` as a capability gate.
12. `convex/convex.config.ts` — component registration. Add `agent` and `rateLimiter`.
13. `package.json` — current versions of `ai`, `radix-ui`, `motion`, `react-markdown`. AI SDK is already `ai@^6.0.62`; AI Elements is compatible.
14. `components.json` — shadcn config (`new-york` style, `neutral` base). AI Elements needs no config changes.
15. Upstream docs (WebFetch once before each phase; do not trust memory):
    - `@convex-dev/agent`: `https://github.com/get-convex/agent` + `docs/` folder (streaming, messages, threads, rag, usage-tracking, rate-limiting).
    - AI Elements: `https://elements.ai-sdk.dev/api/registry/{name}.json` for the components to install.
    - AI SDK v6 / Anthropic provider: `node_modules/ai/docs/` and `node_modules/@ai-sdk/anthropic/docs/` (both present in the repo).

---

## 4. Research summary (what the audit found)

### 4a. The schema already accommodates "one table, two modes"

`extractionJobs` (`convex/schema.ts:319–366`) has `userId`, `sourceType`, `status`, `totalPapers`, `processedPapers`, `failedPapers`, `workflowId`, `name`, `description`, `createdAt`, `updatedAt`, `completedAt`. Only `userId`, `name`, `createdAt`, `updatedAt` are mode-agnostic. Everything else becomes `v.optional(...)` once `mode` is added — no data loss, no migration for existing extraction rows (all their fields stay set).

### 4b. The PDF flag today is global; the user wants per-job

`lib/feature-flags/registry.ts:16–30` defines `extraction.pdf` as `{ enabled: true, minimumTier: 0 }`. It's read server-side in `workflow.ts:59–65` (to decide `downloading_pdfs` vs `indexing`) and in `workpoolActions.ts:616` (to short-circuit PDF download). On the UI it's read in `table-view.tsx:55` to decide whether to show PDF content in results. A per-job boolean is a straightforward structural replacement: the flag's role collapses to "is the toggle visible in step 1".

### 4c. `startExtraction` has 9 call sites

`grep -l` → `convex/extraction/mutations/jobs.ts` (definition), `convex/extraction/mutations/internal/onComplete.ts`, `convex/extraction/validators.ts`, `components/extraction/job-creator.tsx`, `convex/extraction/mutations/templates.ts` (template start), `app/extraction/[jobId]/page.tsx` (duplicate button?), `convex/extraction/public-api-routing.test.ts`, `convex/extraction/mutations.ts` (barrel), `components/extraction/report-builder.tsx` (?). Audit each during Task 5.

### 4d. `@convex-dev/agent` is not installed

`package.json` has `@convex-dev/{stripe, rag, workflow, workpool, aggregate}` but not `agent`. Installation steps: `npm install @convex-dev/agent @convex-dev/rate-limiter`, then `app.use(agent)` + `app.use(rateLimiter)` in `convex/convex.config.ts`. The component brings its own tables (`threads`, `messages`, `streamingMessages`, `streamDeltas`, `memories`, `files`, `apiKeys`) inside its namespace — **zero impact on `convex/schema.ts`**.

### 4e. `useChat` is not the right hook

The canonical AI SDK pattern is `useChat` from `@ai-sdk/react` over HTTP. With Convex Agent, messages stream via **WebSocket deltas** inside a Convex reactive query. The hook is `useUIMessages(query, args, { initialNumItems, stream: true })` from `@convex-dev/agent/react`. It returns `usePaginatedQuery`-shaped output with streaming messages spliced in. Every AI Elements component takes its data via props (no `useChat` coupling); feeding them from `useUIMessages` is a 0-line adapter.

### 4f. Missing Agent APIs we must build ourselves

The Agent component deliberately does not ship certain affordances. We build them as mutations + actions:

| Affordance | Built-in? | Build as |
|---|---|---|
| Regenerate last response | No | Mutation deletes last assistant message → schedules `generateResponse` action with the previous user prompt. |
| Clear conversation | No — only `deleteMessageRange` exists (not `deleteAllForThread`) | Loop `deleteMessageRange(0, MAX_SAFE_INTEGER)` until `isDone === true`. |
| `error` from hook | No | Filter `results` for `message.status === "failed"`; render retry button on the failed row. |
| Mid-stream abort | Partial (abort controller is internal) | A separate `abortChatStream` mutation writes an abort-state row; `generateResponse` polls it. **Deferred to §10 — decide before Task 23.** |

Source: `src/client/messages.ts`, `src/client/index.ts` on `github.com/get-convex/agent@main`. Agent listing: `agent.deleteMessage`, `agent.deleteMessages`, `agent.deleteMessageRange`, `agent.deleteThreadAsync`, `agent.deleteThreadSync` (destroys thread — not what we want).

### 4g. AI Elements is transport-agnostic

Every `ai` import in the AI Elements registry is `import type`. The only runtime coupling is shadcn primitives (`button`, `button-group`, `tooltip`, `hover-card`, `collapsible`, `scroll-area`, `badge`, `command`, `select`, `carousel`, `input-group`, `spinner`) and npm deps (`streamdown`, `@streamdown/{cjk,code,math,mermaid}`, `use-stick-to-bottom`, `shiki`, `nanoid`, `motion`, `@radix-ui/react-use-controllable-state`). The shadcn CLI pulls missing primitives automatically. Styling is 100% token-based (shadcn CSS variables) — OkLCh compatible with `app/globals.css`.

One-line edit post-install: `MessageContent` hardcodes `group-[.is-user]:bg-secondary` for user bubbles. To use the project's primary orange, change to `bg-primary text-primary-foreground`. `PromptInputTextarea` binds Enter → submit; override to Cmd+Enter in `handleKeyDown` (gate on `e.metaKey || e.ctrlKey` + `!e.nativeEvent.isComposing`).

### 4h. OpenRouter model slug format

Slugs are `{provider}/{model-name}`, verified against real test fixtures in `convex/models/models.test.ts`: for example `openai/gpt-4o`, `google/gemini-2.5-flash`, `deepseek/deepseek-chat`, `meta-llama/llama-4-405b`, `qwen/qwen3-8b`. **Never invent slugs from memory** — the authoritative set is the `models.modelId` column, populated by `convex/models/sync.ts::syncFromOpenRouter` (24h cron hitting `https://openrouter.ai/api/v1/models`). Pricing columns (`inputPricePerMillion`, `outputPricePerMillion`, optional `cacheReadPricePerMillion`, `cacheWritePricePerMillion`, `reasoningPricePerMillion`) are mirrored from OpenRouter's `pricing.{prompt,completion,input_cache_read,input_cache_write,internal_reasoning}`.

Server default model lives in `SERVER_AI_CONFIG.model` (`AI_MODEL` env var, default `deepseek-chat`). Chat's model picker reads `models` filtered by `isServed: true` sorted by `sortOrder ASC`; the user said "just take the first one on the list" as the picker default.

### 4i. Prompt caching — DISABLED in V1

**User decision: ship chat without prompt caching in V1.** Rationale, verified against the installed source:

- `@openrouter/ai-sdk-provider@6.0.0-alpha.1` routes every request through OpenRouter's **Responses API**. That schema has no `cache_control` field.
- The shipped message converter (`node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:109-146`) reads only `providerOptions?.openrouter?.reasoning_details` — every other `providerOptions.openrouter.*` entry, including `cacheControl`, is dropped before the request leaves the SDK.
- Upstream issues #35 and #389 (both open at the time of writing) confirm this.
- Downgrading to `@openrouter/ai-sdk-provider@5.x` (Chat Completions path, which does forward cache_control) is blocked by `ai@^6.0.62` provider-interface incompatibility.

**Cost impact.** At 20k tokens × Sonnet-class rates, each turn pays ~$0.06 in input. Acceptable for V1; revisit when OpenRouter ships a v6-stable provider that wires `cache_control` through the Responses path.

**Migration-ready shape.** The plan still sends the paper corpus as a separate system message (§5e) and keeps paper ordering byte-deterministic (sort by OpenAlex ID ascending). The day the provider upgrade lands, adding `providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } }` on that single message turns caching on with zero refactor elsewhere.

**Billing note.** In `ai@6`, the v5 field `cachedInputTokens` is deprecated; the canonical path is `usage.inputTokenDetails.cacheReadTokens`. Since nothing is cached today, this field is always zero for chat. Extraction's existing `calculateServerCreditsToDeduct` (`convex/ai/helpers.ts` → `calculateCostInDollars` in `lib/ai/core/cost.ts`) **does NOT account for cache-read tokens** today; chat follows the same pattern for V1 so the math stays unified. When caching lands, both paths inherit cache-aware pricing in one change.

### 4j. `models.category` is untyped

`convex/schema.ts:61` — `category: v.optional(v.string())`. No enum. The model-picker filter uses `isServed === true` only, sorted by `sortOrder ASC`. If `category` values ever stabilise (e.g. `"chat"`, `"embedding"`), filter further — defer.

### 4k. Bucket clears on submit

`components/extraction/job-creator.tsx:133` calls `clearBucket()` unconditionally in the existing submit handler. Correct for both modes — chat reads papers from the persisted `extractionJobSources` rows (same as extraction), not from the in-memory bucket. The sidebar component on the results page never touches `useBucketStore`.

### 4l. Test reality check

CLAUDE.md bans CSS-class assertions. Every behavioural state the chat UI introduces — "this message is streaming", "this message failed", "this is the user's bubble", "chat mode enabled" — needs a `data-*` attribute or ARIA role so tests survive cosmetic refactors. Layout (line-clamp, scroll-to-bottom) is visual-regression territory, not JSDOM.

---

## 5. Architectural decisions (locked)

### 5a. Schema delta on `extractionJobs`

```ts
extractionJobs: defineTable({
  // existing
  userId: v.id("users"),
  sourceType: v.optional(v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed"))),
  name: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),

  // NEW
  mode: v.union(v.literal("extraction"), v.literal("chat")),         // REQUIRED discriminator
  usePdfs: v.optional(v.boolean()),                                  // extraction-only: per-job PDF opt-in
  chatThreadId: v.optional(v.string()),                              // chat-only: agent thread
  chatModelId: v.optional(v.id("models")),                           // chat-only: current model choice
  lastMessageAt: v.optional(v.number()),                             // chat-only: denorm for sort/list
  messageCount: v.optional(v.number()),                              // chat-only: denorm for list card
  isGenerating: v.optional(v.boolean()),                             // chat-only: single-in-flight guard (§5m)
  generatingStartedAt: v.optional(v.number()),                       // chat-only: stale-flag cleanup (5 min cron)

  // formerly required, now optional (unset for chat)
  status: v.optional(v.union(/* existing 7 values */)),
  totalPapers: v.optional(v.number()),
  processedPapers: v.optional(v.number()),
  failedPapers: v.optional(v.number()),
  workflowId: v.optional(v.string()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])                     // unchanged
  .index("by_user_mode_updated", ["userId", "mode", "updatedAt"])    // NEW — list query
  .index("by_workflow", ["workflowId"]),                             // unchanged
```

**Existing rows**: all have `mode` unset. Backfill in one migration: `mode: "extraction"`. Every extraction-specific field stays populated on those rows.

### 5b. Per-job PDF toggle

- `extraction.pdf` feature flag becomes a **capability gate**: when `false`, the toggle is hidden in step 1 and every new extraction job is persisted with `usePdfs: false`. When `true`, the toggle is visible and the user's choice is persisted.
- `workflow.ts:59–65` (old): `step.runQuery(getPdfExtractionEnabled)` → change to `job.usePdfs ?? false`.
- `workpoolActions.ts:616` (old): `if (!pdfEnabled)` → `if (!job.usePdfs)`. Read `job.usePdfs` from the `extractionJobs` row at the top of the action.
- `table-view.tsx:55` (UI): `useFeatureFlag("extraction.pdf")` → `job.usePdfs` (thread via props).

The flag-reading query `getPdfExtractionEnabledInternal` stays as-is but its callers get rewritten; after rewrite it has 0 consumers, delete it.

### 5c. Unified `startJob`

```ts
export const startJob = mutation({
  args: {
    name: v.string(),
    mode: v.union(v.literal("extraction"), v.literal("chat")),
    bucketItems: v.array(bucketItemInputValidator),

    // extraction-only
    questions: v.optional(v.array(questionInputValidator)),
    usePdfs: v.optional(v.boolean()),

    // chat-only
    chatModelId: v.optional(v.id("models")),
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args) => {
    // shared: auth, rate-limit, feature gate
    const user = await requireAuth(ctx);
    await requireFeature(ctx, args.mode === "chat" ? "extraction.chat" : "extraction.enabled");
    await rateLimit(ctx, { name: "start-extraction", key: user._id, throws: true });

    // shared: bucket validation + source persistence
    const deduped = dedupeBucketItems(args.bucketItems);
    await assertBucketWithinLimits(ctx, user._id, deduped);
    const sourceType = deriveSourceType(deduped);

    // shared: insert job row
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: args.name,
      mode: args.mode,
      sourceType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(args.mode === "extraction" ? {
        status: "pending",
        totalPapers: 0,
        processedPapers: 0,
        failedPapers: 0,
        usePdfs: args.usePdfs ?? false,
      } : {
        messageCount: 0,
        chatModelId: args.chatModelId ?? await defaultChatModelId(ctx),
      }),
    });
    await writeJobSources(ctx, jobId, deduped);

    // mode-specific tail
    if (args.mode === "extraction") {
      for (let i = 0; i < (args.questions ?? []).length; i++) {
        const q = args.questions![i];
        await ctx.db.insert("extractionQuestions", { jobId, ...q, order: i });
      }
      const workflowId = await workflow.start(ctx, internal.extraction.workflow.runExtractionWorkflow, { jobId });
      await ctx.db.patch(jobId, { workflowId, updatedAt: Date.now() });
    } else {
      // Chat: schedule thread creation in an action (requires Node runtime + agent SDK)
      await ctx.scheduler.runAfter(0, internal.chat.threads.ensureThreadForJob, { jobId });
    }

    return { jobId };
  },
});
```

`startJobFromTemplate` and `duplicateJob` wrap `startJob` with template / duplicate-specific argument construction.

### 5d. Chat backend file layout (all new under `convex/chat/`)

- `convex/chat/agent.ts` — `paperChat = new Agent(components.agent, { ... })`. No embedding model (chat doesn't use RAG). `languageModel` constructed via `resolveOpenRouterModel`. `usageHandler` calls `internal.credits.internal.deductCredits` with cost from `calculateServerCreditsToDeduct(usage, pricing)` — the exact helper extraction uses.
- `convex/chat/threads.ts` — `ensureThreadForJob(jobId)` (internal mutation → schedules internal action → createThread → patch `chatThreadId` onto job + `defaultSystemPrompt` from the paper set). `authorizeThreadAccess(ctx, threadId)` helper. `deleteThreadAndJob` (cascade delete).
- `convex/chat/context.ts` — `buildSystemPromptForJob(jobId)` renders the paper corpus as stable XML with `[P1]..[PN]` IDs (sorted by `openalexId ASC` to keep the cache key deterministic). Called from `ensureThreadForJob`.
- `convex/chat/messages.ts` — `listThreadMessages` (query, returns `syncStreams` + `listUIMessages` paginated), `sendMessage` (mutation, saves user message with `skipEmbeddings: true`, schedules `generateResponse`), `generateResponse` (internal action, calls `paperChat.streamText` with `saveStreamDeltas: { chunking: "word", throttleMs: 100 }`), `regenerateLastAssistant` (mutation), `clearThread` (mutation, loops `deleteMessageRange`).
- `convex/chat/model.ts` — `swapModel` mutation (patches `chatModelId`). `listChatModels` query (filtered by `isServed`, sorted by `sortOrder`).
- `convex/chat/concurrency.ts` — `acquireThreadLock(ctx, jobId)` mutation (checks + sets `isGenerating`, throws `CONFLICT` if already held), `releaseThreadLock(ctx, jobId)` internal mutation (clears flag; idempotent), `cleanupZombieChatLocks` internal mutation (cron-triggered, clears flags with `generatingStartedAt < now - 5*60*1000`).
- `convex/chat/provider.ts` — `resolveOpenRouterModel(ctx, modelId)` — thin wrapper around existing `getProviderModel('openrouter', undefined, modelId, { openrouterProviderOrder })` from `lib/ai/server/providers.ts`. Returns `{ model, pricing }` so `generateResponse` can pass both to `streamText` and to the credit math.

### 5e. Prompt structure

**Caching disabled in V1** (user decision). `@openrouter/ai-sdk-provider@6.0.0-alpha.1`'s Responses-API path drops `providerOptions.openrouter.cacheControl` before the request leaves the SDK (verified by reading `dist/index.mjs:109-146` and upstream issues #35 and #389). We pay full input-token rate per turn (~$0.06/turn at Sonnet 4.5 rates on the 20k-token corpus). Acceptable for V1; revisit when OpenRouter ships v6-stable with cache-forwarding.

`buildSystemPromptForJob` still returns **an array of system messages** — paper corpus separated from instructions keeps the shape migration-ready (drop a cache breakpoint in when the provider wires it up, zero refactor elsewhere):

```ts
return [
  {
    role: "system",
    content:
      "You are a research assistant answering questions about the user's selected papers.\n" +
      "Cite papers by their id in square brackets (e.g. [P3]) whenever you use their content.\n" +
      "If an answer is not supported by the papers, say so explicitly."
  },
  {
    role: "system",
    content: `<papers count="${papers.length}">\n${corpus}\n</papers>`,
    // No providerOptions.cacheControl — OpenRouter v6-alpha drops it silently.
    // Add `providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } }`
    // the day we upgrade to a provider version that forwards cache_control.
  },
];
```

`corpus` builds as:

```
<paper id="P1" openalex="W123">
<title>…</title>
<year>2023</year>
<authors>Smith, Doe</authors>
<abstract>…</abstract>
</paper>

<paper id="P2" …>
…
</paper>
```

Threads store this as `threads.defaultSystemPrompt` so every `streamText` call reuses the exact same prefix → prompt cache hits.

### 5f. Streaming architecture — `agent.streamText` via scheduler

```ts
// convex/chat/messages.ts
export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, prompt }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);

    // Concurrency gate — one in-flight generation per chat thread.
    if (job.isGenerating) {
      throw createError("CONFLICT", "A response is already being generated for this chat.");
    }

    const { messageId } = await paperChat.saveMessage(ctx, {
      threadId, prompt, skipEmbeddings: true,
    });
    // Atomic with the user-message insert — Convex mutation = transaction.
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: (job.messageCount ?? 0) + 1,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.chat.messages.generateResponse, { threadId, promptMessageId: messageId });
    return null;
  },
});

export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, { threadId, promptMessageId }) => {
    const { jobId, userId, chatModelId } = await ctx.runQuery(
      internal.chat.threads.getModelForThread, { threadId },
    );
    try {
      // Pre-flight credit check — mirrors extraction's `waitAndExtractAction`
      // (convex/extraction/workpoolActions.ts lines 844–874). Throws AI_INSUFFICIENT_CREDITS.
      const balance = await ctx.runQuery(
        internal.credits.internal.getBalanceByUserId, { userId },
      );
      if (!balance || balance.total < ESTIMATED_CREDITS_PER_CHAT_MESSAGE) {
        throw createError("AI_INSUFFICIENT_CREDITS", "Not enough credits for this chat message.");
      }

      // Resolve OpenRouter model via existing helper — no AI Gateway, no direct provider SDKs.
      const { model } = await resolveOpenRouterModel(ctx, chatModelId);

      const result = await paperChat.streamText(
        ctx,
        { threadId },
        { promptMessageId, model },
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
      // Credit deduction happens inside Agent's usageHandler after streamText resolves (see §5n).
    } finally {
      // ALWAYS release the concurrency lock — on success, error, or AI_INSUFFICIENT_CREDITS throw.
      // The cleanup cron (§5m) is only a safety net for hard process crashes, not exceptions.
      await ctx.runMutation(internal.chat.concurrency.releaseThreadLock, { jobId });
    }
  },
});
```

`useUIMessages(api.chat.messages.listThreadMessages, { threadId }, { initialNumItems: 20, stream: true })` on the client sees the optimistic user row immediately (via `.withOptimisticUpdate(optimisticallySendMessage(api.chat.messages.listThreadMessages))`), then the assistant row as deltas land.

### 5g. Regenerate + clear

```ts
export const regenerateLastAssistant = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    // Use agent.listMessages for server-side ordering (returns MessageDoc[]) — we only
    // need the last two server-side rows for regenerate.
    const page = await paperChat.listMessages(ctx, { threadId, paginationOpts: { numItems: 2, cursor: null } });
    const [priorUser, lastAssistant] = page.page.slice(-2);
    if (!lastAssistant || lastAssistant.message?.role !== "assistant") return null;
    if (!priorUser || priorUser.message?.role !== "user") return null;
    await paperChat.deleteMessage(ctx, { messageId: lastAssistant._id });
    await ctx.scheduler.runAfter(0, internal.chat.messages.generateResponse,
      { threadId, promptMessageId: priorUser._id });
    return null;
  },
});

export const clearThread = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    let lastOrder: number | undefined = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await paperChat.deleteMessageRange(ctx, {
        threadId, startOrder: lastOrder ?? 0, endOrder: Number.MAX_SAFE_INTEGER,
      });
      if (r.isDone) break;
      lastOrder = r.lastOrder;
    }
    return null;
  },
});
```

### 5h. Step 1 / step 3 stepper shape

Step 1 layout (`job-creator.tsx:278–315`) becomes:

```
Header:          "Mode & Details"
<ModeSelector value={mode} onChange={setMode} />                     // two radio-cards
<Input label="Job name" value={name} onChange={setName} />
{mode === "extraction" && flags["extraction.pdf"] && (
  <Switch label="Use PDFs" checked={usePdfs} onChange={setUsePdfs} />
)}
{mode === "chat" && (
  <ModelPicker value={chatModelId} onChange={setChatModelId} />
)}
```

Step 3 content branches:

```
{validStep === 3 && (
  mode === "extraction"
    ? <QuestionBuilder />
    : <ChatStartReview papers={readyBucketItems} model={chatModelId} />
)}
```

`ChatStartReview` shows: paper count, warnings (if any papers have no abstract), the chosen model, a single "Start chat" button (same CTA text via i18n as existing submit).

### 5i. Results-page branch

`app/extraction/[jobId]/page.tsx` grows a single conditional at the main-content slot (around line 730):

```tsx
{job.mode === "chat"
  ? <ChatJobView jobId={jobId} job={job} threadId={job.chatThreadId!} />
  : <ExtractionResultShell /* existing tabs + view switcher */ />}
```

Results toolbar (`results-toolbar.tsx`) renders nothing when `job.mode === "chat"` — hide, don't disable. Tab navigation (Results / Insights / Review / Report) hides in chat mode; chat mode has no tabs.

### 5j. `ChatJobView` layout

```
components/extraction/chat/
  chat-job-view.tsx              # TwoColumnLayout wrapper
  papers-in-context-sidebar.tsx  # Desktop Collapsible; mobile Sheet trigger
  message-list.tsx               # Conversation + Message (AI Elements) + PaperChip resolution
  message-composer.tsx           # PromptInput (AI Elements) + Cmd+Enter override
  message-actions.tsx            # Copy + Retry (MessageAction from AI Elements)
  model-picker.tsx               # Select over isServed models
  suggestion-chips.tsx           # Suggestion (AI Elements) for empty threads
  clear-conversation.tsx         # Button + AlertDialog confirm
  paper-citation.tsx             # Renders [P3] using AI Elements InlineCitation primitives (§5k)
  abstract-missing-banner.tsx    # Rendered in step 2 of JobCreator when mode === "chat"
```

### 5k. Paper-chip resolution — adapt AI Elements `InlineCitation`

**User decision: adapt the existing AI Elements `InlineCitation` primitives rather than build a custom `PaperChip`.** The `@elements/ai-sdk` registry ships `InlineCitationCard`, `InlineCitationCardTrigger`, `InlineCitationCardBody`, `InlineCitationSource`, `InlineCitationCarouselContent`, etc. — HoverCard + Badge + Carousel scaffolding that's already token-styled (no hex / no Tailwind-color overrides needed). Default `InlineCitationCardTrigger` derives its label from `new URL(sources[0]).hostname`, which doesn't match our `[P3]` format — but the sub-primitives are self-contained, so we wrap them with our own trigger.

**Architecture (two files, both thin):**

- **`lib/chat/resolve-paper.ts`** (pure, unit-tested): `resolvePaperReference(text: string, papers: Paper[]): { start: number; end: number; index: number; paper: Paper | null }[]`. Matches `/\[P(\d+)\]/g`, looks up each `index - 1` against `papers`. Returns byte offsets so a renderer can split the text. Pure — no React.
- **`components/extraction/chat/paper-citation.tsx`** (renderer): consumes the matches array, renders the surrounding text as plain spans and each match as an `<InlineCitationCard>` with our trigger (a `Badge` showing `[P{n}]`) and body rendering title / authors / year / a DOI link.

```tsx
import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { Badge } from "@/components/ui/badge";

export function PaperCitation({ index, paper }: { index: number; paper: Paper | null }) {
  if (!paper) return <span className="text-muted-foreground">[P{index}?]</span>;
  return (
    <InlineCitationCard>
      <Badge variant="secondary" data-paper-id={paper._id} data-paper-index={index}>
        [P{index}]
      </Badge>
      <InlineCitationCardBody>
        <InlineCitationSource
          title={paper.title}
          description={`${paper.authors?.join(", ")} · ${paper.publicationYear ?? "—"}`}
          url={paper.doi ? `https://doi.org/${paper.doi}` : `https://openalex.org/${paper.openalexId}`}
        />
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}
```

**Integration with Streamdown.** Streamdown accepts custom `components` map. We intercept the `p` renderer (paragraphs) and, for every text node, call `resolvePaperReference` + rebuild the children array splicing `<PaperCitation>` at each match. Approximately 40 lines. No remark plugin — simpler, and integrates cleanly with streaming partial markdown.

**No separate `remark-paper-chips.ts` file.** The earlier plan drafts included a remark plugin; adapting AI Elements makes it unnecessary. Parser logic moves to `lib/chat/resolve-paper.ts`, which is already in the pure-logic test list.

### 5l. Error state

`message.status === "failed"` renders the bubble with `data-error="true"` + a retry button wired to `regenerateLastAssistant`. If the message has no visible content (stream died immediately), render `<Alert variant="destructive">` inline with the error text from `message.metadata?.error`.

### 5m. Concurrency — single-in-flight per thread + per-user cap of 3 (tier-scaled)

No rate limiter. User directive: OpenRouter is the server's provider, there is no frequency gate to enforce. Two concurrency gates:

1. **Per-thread gate:** one assistant generation at a time per chat thread. Enforced by the `isGenerating: boolean` flag on `extractionJobs` (§5a). Prevents double-generation on the same thread.
2. **Per-user cap:** at most `getChatConcurrencyLimit(ctx, userId)` concurrent in-flight generations across **all** of a user's chat threads. Seeded at 3 for every plan; future subscription tiers raise it. Mirrors `getPaperLimit` at `convex/extraction/bucket/limits.ts` verbatim.

**Tier-limit pattern (exact mirror of existing `PAPER_LIMIT_BY_PLAN`).** Extend `convex/extraction/bucket/limits.ts`:

```ts
export const CHAT_CONCURRENCY_LIMIT_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 3,
  go: 3,
  pro: 3,
  enterprise: 3,
};
export const CHAT_CONCURRENCY_LIMIT_MAX = Math.max(
  ...Object.values(CHAT_CONCURRENCY_LIMIT_BY_PLAN),
);

export async function getChatConcurrencyLimit(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const plan = await resolvePlan(ctx, userId);                       // existing helper in same file
  return CHAT_CONCURRENCY_LIMIT_BY_PLAN[plan];
}

export const getChatConcurrencyLimitForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, { userId }) => getChatConcurrencyLimit(ctx, userId),
});
```

Public UI query in `convex/extraction/bucket/queries.ts` alongside the existing `getMyPaperLimit`:

```ts
export const getMyChatConcurrencyLimit = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return getChatConcurrencyLimit(ctx, user._id);
  },
});
```

All four plan slots return `3` in V1. The slot-and-override map makes tier differentiation a one-line change later.

**Counting user's in-flight chats** — uses the `by_user_mode_updated` index (§5a) prefix:

```ts
async function countUserInFlightChats(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const jobs = await ctx.db
    .query("extractionJobs")
    .withIndex("by_user_mode_updated", q => q.eq("userId", userId).eq("mode", "chat"))
    .collect();
  return jobs.filter(j => j.isGenerating === true).length;
}
```

O(user's chat count), not O(all jobs). If it becomes hot, promote to a denormalised counter on the user row.

**Protocol** (matches the codebase's existing idempotency-flag style — `indexingBilled` / `extractionBilled` on `extractionPapers`):

1. `sendMessage` mutation checks `job.isGenerating` first — if `true`, throws `createError("CONFLICT", "This chat is still generating")`.
2. Same mutation counts user's in-flight chats via the index query above; if `count >= getChatConcurrencyLimit(ctx, user._id)`, throws `createError("CONFLICT", `You have reached the limit of ${N} concurrent chats. Wait for one to finish.`)`.
3. Same mutation patches `{ isGenerating: true, generatingStartedAt: Date.now() }` **atomically** with the user-message insert (single Convex mutation = single transaction).
4. `generateResponse` action wraps `paperChat.streamText` in `try/finally`. The `finally` block calls `internal.chat.concurrency.releaseThreadLock({ jobId })`, which patches `{ isGenerating: false, generatingStartedAt: undefined }`. Fires even on error / abort / `AI_INSUFFICIENT_CREDITS` throw — JS `finally` is the right primitive.

**Zombie cleanup.** Hard-crash recovery (Convex runtime killed, not an exception): `cleanupZombieChatLocks` runs via `crons.interval("cleanup zombie chat locks", { minutes: 5 }, ...)` and patches any `extractionJobs` row where `mode === "chat" && isGenerating === true && generatingStartedAt < now - 5*60*1000` back to `isGenerating: false`. Logs the clear for observability. Pattern mirrors the existing OpenRouter sync cron in `convex/crons.ts`.

**UI feedback:**

- Composer send button renders disabled with a small spinner (reuse `Loader2` from extraction report/insights panels) while `isGenerating === true`.
- Retry button on the last assistant message is hidden during streaming.
- Clear-conversation is disabled with tooltip "Wait for the response to finish".
- When the per-user cap is hit: toast "You have {N} chats generating — wait for one to finish." `{N}` comes from `useQuery(api.extraction.bucket.queries.getMyChatConcurrencyLimit)`.

The `isGenerating` field is read by the client through the existing `useQuery(api.extraction.queries.getJob, ...)` subscription — Convex's reactive query re-renders on change automatically.

### 5n. Usage handler → credits (matches extraction's exact pattern)

**Critical:** do not invent a new credit path. Use the exact helpers extraction uses after its LLM calls — `calculateServerCreditsToDeduct(usage, pricing)` from `convex/ai/helpers.ts` and `internal.credits.internal.deductCredits` from `convex/credits/internal.ts` (lines ≈1437–1527 per research — open the file and confirm before calling). Verified in research: `deductCredits` is the single chokepoint; it reads the user's `credits` row, asserts sufficiency, deducts from `freeBalance` first then `paidBalance`, writes a `creditTransactions` row, and patches `lifetimeUsed` — all atomically inside one Convex mutation.

```ts
// convex/chat/agent.ts
import { calculateServerCreditsToDeduct } from "../ai/helpers";
import { internal } from "../_generated/api";

export const paperChat = new Agent(components.agent, {
  // ... other options ...
  usageHandler: async (ctx, { userId, usage, model /* OpenRouter model slug */ }) => {
    if (!userId) return; // Agent passes userId through from saveMessage; defensive guard.

    // Pricing lookup mirrors extraction's `fetchServerPricing` (convex/ai/helpers.ts).
    const pricing = await ctx.runQuery(
      internal.models.queries.getPricing, { modelId: model },
    );

    // Exact same cost math as extraction — minimum 1 credit if any tokens consumed
    // (`calculateCreditsToDeductFromUsage` in lib/ai/core/cost helpers).
    const credits = calculateServerCreditsToDeduct(usage, pricing ?? { input: 0, output: 0 });
    if (credits <= 0) return;

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId,
      amount: credits,
      description: "AI: Chat message",
      metadata: {
        billingType: "chat_llm",
        model,
        inputTokens: String(usage.inputTokens ?? 0),
        outputTokens: String(usage.outputTokens ?? 0),
      },
    });
  },
});
```

**Notes:**

- `internal.credits.internal.deductCredits` is the real path — verified against `convex/credits/internal.ts`. Earlier plan drafts wrote `credits.deduct`; wrong.
- `description: "AI: Chat message"` mirrors extraction's `"AI: Extraction embedding index"` / `"AI: Extraction (N questions)"` convention — transaction history stays readable.
- **No idempotency flag on chat messages.** `generateResponse` is scheduled exactly once per user message (`ctx.scheduler.runAfter(0, ...)` is fire-and-forget, not retried). Extraction needs `indexingBilled` / `extractionBilled` because it runs inside `@convex-dev/workpool` with `maxAttempts: 3`. Chat doesn't. If we later introduce retries, add a `billed: boolean` on the assistant message row and gate on it.
- Usage field mapping follows extraction's convention (`convex/extraction/workpoolActions.ts` lines ≈347–348): `inputTokens ?? promptTokens ?? 0`. Cache-read tokens (`usage.inputTokenDetails.cacheReadTokens` in `ai@6`; the old `cachedInputTokens` is deprecated) are **not discounted** — consistent with extraction. See §4i for the rationale.
- `SERVER_AI_CONFIG.provider` + `AI_COST_MARKUP` multiplier are applied transparently inside `calculateServerCreditsToDeduct`; no extra multiplication needed here.

**Pre-flight balance check** lives in `generateResponse`, not `usageHandler` — calls `internal.credits.internal.getBalanceByUserId`, throws `AI_INSUFFICIENT_CREDITS` if `total < ESTIMATED_CREDITS_PER_CHAT_MESSAGE`. New constant in `convex/lib/constants.ts`, seeded at ~200 (scale with extraction's `ESTIMATED_CREDITS_PER_QUERY` shape). Matches the pattern at `waitAndExtractAction:844–874`.

### 5o. History list

`job-list-item.tsx` receives mode + lastMessageAt + messageCount. Render:

```
Extraction: "12 papers · running · 3h ago"    [Extraction] badge
Chat:       "12 papers · 4 messages · 2h ago" [Chat] badge
```

Sort switches from `by_user_status` index to `by_user_mode_updated` with a unified `.order("desc")` on `updatedAt` (chat and extraction rows interleave naturally). No mode filter for V1 — defer.

### 5p. a11y contract (for tests + screen readers)

- Message list container: `<ol role="log" aria-live="polite" aria-relevant="additions">`.
- Streaming assistant bubble: `aria-busy="true"` until `status !== "streaming"`.
- Message row: `data-role="user" | "assistant"`, `data-status={message.status}`, `data-error={message.status === "failed"}`.
- Copy/retry buttons: `aria-label="Copy message"` / `aria-label="Regenerate response"`.
- Mode selector: `<RadioGroup>` with `data-mode={mode}` on the root, `data-value` on each radio.
- PDF toggle: `<Switch>` with `aria-label="Use PDFs"`, `data-pdf-enabled={usePdfs}`.
- Clear-conversation: `<AlertDialog>` with proper `aria-labelledby` / `aria-describedby`.

### 5q. `extraction.chat` feature flag

New entry in `lib/feature-flags/registry.ts`: `{ enabled: false, minimumTier: 0, description: "Chat mode for job creation" }`. Ships OFF by default; flip on per-environment when ready. When off, `<ModeSelector>` only shows "Data Extraction" (or hides the selector entirely — a single-mode path).

---

## 6. Task list

Ordered. Later tasks depend on earlier. Each is an atomic commit. Commit prefix `P9.T<N>.<sub>`.

### Phase A — Infrastructure

#### Task 0 — Foundation: add `CONFLICT` error code

**Why.** §5m throws `createError("CONFLICT", …)` for the concurrency gate, but `"CONFLICT"` is NOT currently in the `ErrorCode` union at `convex/lib/errors.ts` (verified by the DRY audit — the current union covers `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `INSUFFICIENT_CREDITS`, `FEATURE_DISABLED`, and a few others, but not `CONFLICT`). Without this, every chat mutation using the concurrency gate will fail typecheck at the `createError` call. User directive: prepare foundations first.

**Test first.** `convex/lib/__tests__/errors.test.ts` (extend if it exists, otherwise create a 5-line file): `createError("CONFLICT", "x")` returns an Error whose `.data.code === "CONFLICT"`.

**Implementation.**
1. `convex/lib/errors.ts` — add `| "CONFLICT"` to the `ErrorCode` union.
2. If the file has a mapping table of code → HTTP-style status / user-facing message, add `CONFLICT: { status: 409, defaultMessage: "This resource is currently in use." }` following the existing shape.

**Done when.** `grep -n '"CONFLICT"' convex/lib/errors.ts` shows the code; tests green.

---

#### Task 1 — Install the Convex Agent component + OpenRouter compatibility probe

**Why.** Chat backend needs the Agent component. **Rate limiter is explicitly NOT installed** — user directive: OpenRouter is the server's provider, no rate limits.

**Implementation.**
1. `npm i @convex-dev/agent`.
2. `convex/convex.config.ts`:
   ```ts
   import agent from "@convex-dev/agent/convex.config";
   // ...
   app.use(agent);
   ```
3. `npx convex dev` once to regenerate `components.agent`.
4. **OpenRouter + Agent compat is confirmed compatible — no probe needed.** `@convex-dev/agent`'s `AssertAISDKv6<T>` guard (`src/client/types.ts:53-55`) requires `specificationVersion: "v3"`. `@openrouter/ai-sdk-provider@6.0.0-alpha.1`'s `OpenRouterChatLanguageModel` declares `readonly specificationVersion: "v3"` (`dist/index.d.ts:8-9`). It passes the type guard. **Pass OpenRouter directly as `languageModel`** — no adapter, no fallback path required. This was a genuine uncertainty in an earlier draft of this plan; it has been resolved by reading both libraries' source.

**Done when.** `grep -r 'components\.agent' convex/_generated/` returns typed references; `npx tsc --noEmit` is green with `new Agent(components.agent, { languageModel: createOpenRouter().chat("deepseek/deepseek-chat"), ... })` as a smoke sanity check.

---

#### Task 2 — Install AI Elements

**Why.** We render chat with AI Elements primitives, not hand-rolled shadcn widgets (decision §4g).

**Implementation.**
```bash
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/conversation.json
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/message.json
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/prompt-input.json
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/shimmer.json
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/inline-citation.json
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/suggestion.json
```

Components land at `components/ai-elements/*.tsx`. Pulls transitive shadcn primitives (`button-group`, `input-group`, `command`, `hover-card`, `carousel`, `collapsible`, `spinner`) and npm deps (`streamdown`, `@streamdown/*`, `use-stick-to-bottom`, `nanoid`, `motion`, `@radix-ui/react-use-controllable-state`).

Post-install patches:
- `components/ai-elements/message.tsx` — `group-[.is-user]:bg-secondary` → `group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground` (primary orange for user bubbles).
- `components/ai-elements/message.tsx` — if `@streamdown/math` and `@streamdown/mermaid` aren't needed, delete their plugin imports (trim ~300kB gzip).
- `components/ai-elements/prompt-input.tsx` — in `handleKeyDown` of `PromptInputTextarea`, gate submission on `(e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing` + `e.key === "Enter"`. Remove the plain-Enter binding (Shift+Enter as newline stays).

**Done when.** `components/ai-elements/{conversation,message,prompt-input,shimmer,inline-citation,suggestion}.tsx` exist and `npx tsc --noEmit` is green.

---

#### Task 3 — Schema delta + feature flag

**Why.** §5a, §5q.

**Test first.** `convex/__tests__/schema.test.ts` (or the existing schema smoke test): assert the new fields (`mode`, `usePdfs`, `chatThreadId`, `chatModelId`, `lastMessageAt`, `messageCount`) exist and that existing status/counter fields are `v.optional(...)`.

**Implementation.**
1. `convex/schema.ts:319–366` — apply §5a delta. Add `by_user_mode_updated` index.
2. `lib/feature-flags/registry.ts` — add `"extraction.chat": { enabled: false, minimumTier: 0, description: "Chat mode for job creation" }`.
3. Backfill migration (one-off `internalMutation` in `convex/migrations/setExistingJobsToExtractionMode.ts`):
   ```ts
   for await (const job of ctx.db.query("extractionJobs")) {
     if (job.mode === undefined) await ctx.db.patch(job._id, { mode: "extraction" });
   }
   ```
   Run once via `npx convex run migrations/setExistingJobsToExtractionMode`.

**Done when.** Schema test green; migration run locally; `npx convex dev` accepts the new schema without validation errors on existing rows.

---

### Phase B — Unified job creation (backend)

#### Task 4 — Per-job PDF toggle wiring

**Why.** §5b. Prerequisite for step-1 UI in Phase C.

**Test first.** `convex/extraction/__tests__/workflow.test.ts`: given a job with `usePdfs: false`, the workflow transitions to `"indexing"` (skipping `"downloading_pdfs"`) regardless of the feature-flag value. Given `usePdfs: true` + flag `false`, the PDF branch still short-circuits (flag wins as capability gate).

**Implementation.**
1. `convex/extraction/workflow.ts:59–65` — replace `step.runQuery(getPdfExtractionEnabled)` with `step.runQuery(getJobUsePdfs, { jobId })` + flag gate:
   ```ts
   const flagOn = await step.runQuery(internal.featureFlags.queries.isEnabled, { key: "extraction.pdf" });
   const job = await step.runQuery(internal.extraction.queries.internal.getJobInternal, { jobId });
   const usePdfs = flagOn && (job.usePdfs ?? false);
   ```
2. `convex/extraction/workpoolActions.ts:616` — same pattern: read `job.usePdfs` + flag; gate.
3. Delete `getPdfExtractionEnabledInternal` once no callers remain.
4. `components/extraction/results-views/table-view.tsx:55` — thread `job.usePdfs` via props instead of `useFeatureFlag`.

**Done when.** Test green; manual smoke: disable `extraction.pdf` flag in admin → new extraction jobs ignore the `usePdfs` toggle; existing jobs with `usePdfs: true` + flag off still short-circuit.

---

#### Task 5 — Collapse `startExtraction` + `startExtractionFromTemplate` + `duplicateExtraction` into `startJob`

**Why.** §5c. Single entry simplifies the UI and keeps auth / rate-limit / bucket-validation logic in one place.

**Test first.** `convex/extraction/public-api-routing.test.ts` (existing): the test currently covers `startExtraction`; extend to cover both modes. Given `mode: "extraction"`, expect workflow starts. Given `mode: "chat"`, expect a scheduled `ensureThreadForJob` action with the new `jobId`.

**Implementation.**
1. Rewrite `convex/extraction/mutations/jobs.ts` per §5c. Delete `startExtraction` entirely.
2. Rewrite `convex/extraction/mutations/templates.ts` — `startJobFromTemplate({ templateId, mode, questions?, chatModelId? })` constructs `bucketItems` from the template and calls `startJob`. Templates keep their existing `sourceType` / `questions` shape; chat-mode templates are a V2 concern (flag: §10).
3. Rewrite duplicate logic wherever it lives (`report-builder.tsx`? `app/extraction/[jobId]/page.tsx`?): `duplicateJob({ jobId })` reads the source job's mode and reconstructs `startJob` args.
4. Update every call site from the grep in §4c:
   - `components/extraction/job-creator.tsx:107–140` — pass `mode: draftJob.mode`, `usePdfs`, `chatModelId`, `questions`.
   - `convex/extraction/mutations/internal/onComplete.ts` — if it references `startExtraction` for retries, rewrite to `startJob`.
   - `convex/extraction/validators.ts` — `startExtractionArgs` becomes `startJobArgs` (extended shape).
   - `convex/extraction/mutations.ts` (barrel) — re-export `startJob`, remove `startExtraction`.
   - `components/extraction/report-builder.tsx` — rewrite the "re-run" button.
   - `convex/extraction/public-api-routing.test.ts` — update assertions.

**Done when.** `grep -r "startExtraction\b" .` returns 0 matches. Full test suite green. Manual: creating an extraction job from the UI still lands on `/extraction/[jobId]` and the workflow runs.

---

### Phase C — Job creation UI

#### Task 6 — Draft store + mode-aware step 1

**Why.** §5h. The store holds `mode` + `chatModelId` so step 3's CTA knows which branch to take.

**Test first.** `lib/store/__tests__/extraction.test.ts`: `setMode("chat")` clears `questions`, sets default `chatModelId` (first served model); `setMode("extraction")` clears `chatModelId`, resets `usePdfs` to flag default.

**Implementation.**
1. `lib/store/extraction.ts` — add:
   ```ts
   mode: "extraction" | "chat"
   chatModelId: Id<"models"> | null
   usePdfs: boolean
   setMode: (m) => void
   setChatModelId: (id) => void
   setUsePdfs: (b) => void
   ```
   Default: `mode: "extraction"`, `usePdfs: flag default`, `chatModelId: null` (resolved at submit time from the model picker or falls back to first served).
2. `components/extraction/job-creator.tsx:278–315` — replace step-1 body with:
   ```tsx
   <ModeSelector value={mode} onChange={setMode} />
   <NameInput value={name} onChange={setName} />
   {mode === "extraction" && flags["extraction.pdf"] && (
     <PdfToggle value={usePdfs} onChange={setUsePdfs} />
   )}
   {mode === "chat" && (
     <ModelPicker value={chatModelId} onChange={setChatModelId} />
   )}
   ```
3. New `components/extraction/mode-selector.tsx` — two `<RadioGroup>` cards (Extraction + Chat), each with icon, title, 1-line description. Root has `data-mode={value}`. Each radio has `data-value="extraction" | "chat"`.
4. New `components/extraction/pdf-toggle.tsx` — shadcn `<Switch>` with `aria-label="Use PDFs"` and `data-pdf-enabled`. 8 lines.
5. New `components/extraction/model-picker.tsx` — shadcn `<Select>` over `useQuery(api.chat.model.listChatModels)`. Renders `model.name` in the trigger, grouped by `model.provider`. Root `data-model-id={value}`.
6. Update step labels in `job-creator.tsx:76–80`: first step title → "Mode & Details".

**Done when.** Store test green. Manual: step 1 renders mode picker; choosing Chat hides the PDF toggle and shows the model picker; URL step param persists across mode changes.

---

#### Task 7 — Step 2 missing-abstract banner

**Why.** §1 V1 affordance #9.

**Test first.** `components/extraction/__tests__/job-creator.test.tsx`: given `mode === "chat"` + bucket contains 5 items, 2 of them `abstract === undefined`, assert a banner with `role="status"` and text containing "2 of 5 papers have no abstract".

**Implementation.**
1. New `components/extraction/chat/abstract-missing-banner.tsx` — reads `useBucketStore((s) => s.items)`, counts missing abstracts, renders a shadcn `<Alert variant="default">` only when count > 0. `role="status"` + `data-missing-count={count}`.
2. Mount inside `job-creator.tsx:317–335` (step 2 body), gated on `mode === "chat"`.

**Done when.** Test green. Manual: step 2 shows the banner only in chat mode and only when papers without abstracts are staged.

---

#### Task 8 — Step 3 branch (Questions vs Review)

**Why.** §5h.

**Test first.** `components/extraction/__tests__/job-creator.test.tsx`: given `mode === "chat"`, step 3 renders `<ChatStartReview>` (not `<QuestionBuilder>`). Clicking the submit CTA fires `startJob` with `mode: "chat"`.

**Implementation.**
1. `components/extraction/job-creator.tsx:338–356` — conditional:
   ```tsx
   {validStep === 3 && (mode === "extraction"
     ? <QuestionBuilder />
     : <ChatStartReview papers={readyBucketItems} modelId={chatModelId} />)}
   ```
2. New `components/extraction/chat/chat-start-review.tsx`:
   - Heading: "Review & start chat"
   - Row of counters: "N papers · M with abstracts · Model: {modelName}"
   - Call-to-action copy: "You'll be able to ask questions about these {N} papers. You can change the model, clear the conversation, or add more papers later."
   - Submit handled by the existing stepper footer (Task 9 wires the submit).
3. Update the submit handler at `components/extraction/job-creator.tsx:107` to branch on `mode`:
   ```ts
   const { jobId } = await startJob({
     name, mode,
     bucketItems: ...,
     ...(mode === "extraction" ? { questions, usePdfs } : { chatModelId }),
   });
   ```
4. `handleNext` validation: step 3 for chat is always valid (no schema to complete); just enables the submit.

**Done when.** Test green. Manual: step 3 in chat mode shows review; submitting lands on `/extraction/[jobId]` with the new chat UI (Phase E).

---

### Phase D — Chat backend

#### Task 9 — Agent instance + system-prompt builder

**Why.** §5d, §5e.

**Test first.** `convex/chat/__tests__/context.test.ts`:
- `buildSystemPromptForJob(jobId)` returns an array of 2 system messages. Second message carries the paper corpus, has NO `providerOptions` field (caching disabled in V1 per §4i).
- Given 3 papers with the same inputs called twice, both calls produce byte-identical corpus (deterministic ordering by `openalexId`).
- Given papers with `abstract === undefined`, the corpus includes `<abstract>(no abstract available)</abstract>`.

**Implementation.**
1. `convex/chat/agent.ts`:
   ```ts
   import { Agent, stepCountIs } from "@convex-dev/agent";
   import { createOpenRouter } from "@openrouter/ai-sdk-provider";
   import { components } from "../_generated/api";
   import { SERVER_AI_CONFIG } from "../ai/config";

   // Default model — overridden per-call from the job's chatModelId via
   // resolveOpenRouterModel (convex/chat/provider.ts). This is the fallback only.
   const openrouter = createOpenRouter(); // reads OPENROUTER_API_KEY from env
   const defaultLanguageModel = openrouter.chat(SERVER_AI_CONFIG.model);

   export const paperChat = new Agent(components.agent, {
     name: "Paper Chat",
     languageModel: defaultLanguageModel,  // LanguageModelV3 — passes Agent's AssertAISDKv6 guard
     // No embeddingModel — chat does not use RAG in V1. (Do not set `textEmbeddingModel`; deprecated.)
     contextOptions: { recentMessages: 40, excludeToolMessages: true, searchOptions: undefined },
     storageOptions: { saveMessages: "promptAndOutput" },
     stopWhen: stepCountIs(1), // no tool loop in V1
     usageHandler: async (ctx, args) => { /* see §5n */ },
   });
   ```
   **Note**: do NOT import `gateway` from `ai` — we don't use Vercel AI Gateway (§2 hard rule #5). The OpenRouter provider returns `LanguageModelV3`; Agent's `AssertAISDKv6<T>` type guard requires `specificationVersion: "v3"` — confirmed compatible, no adapter needed.
2. `convex/chat/context.ts` — `buildSystemPromptForJob(jobId)`. Read `extractionJobSources` rows for the job, sort by `openalexId ASC`, render XML-tagged corpus. Export `renderPaperCorpus(papers)` as a pure function so it's unit-testable.

**Done when.** Tests green.

---

#### Task 10 — Thread lifecycle

**Why.** §5d.

**Test first.** `convex/chat/__tests__/threads.test.ts`:
- `ensureThreadForJob(jobId)`: patches `chatThreadId` onto the job; sets `defaultSystemPrompt`.
- `authorizeThreadAccess(ctx, threadId)` throws for a user who doesn't own the parent job.

**Implementation.**
1. `convex/chat/threads.ts`:
   ```ts
   export const ensureThreadForJob = internalAction({ ... });
   export const getThreadMetadataForJob = internalQuery({ ... });
   export const getModelForThread = internalQuery({ ... });

   export async function authorizeThreadAccess(
     ctx: QueryCtx | MutationCtx | ActionCtx,
     threadId: string,
   ) {
     const user = await requireAuth(ctx);
     // thread ← jobId (reverse lookup via index)
     const job = await ctx.db.query("extractionJobs")
       .withIndex("by_chatThread", q => q.eq("chatThreadId", threadId))
       .unique();
     if (!job || job.userId !== user._id) throw createError("FORBIDDEN", "Access denied");
     return { job, user };
   }
   ```
2. Add `by_chatThread` index on `extractionJobs` (in the same commit: schema change + index). Schema delta: `.index("by_chatThread", ["chatThreadId"])`.

**Done when.** Tests green. Manual: creating a chat job triggers the scheduled action; the job row gains a `chatThreadId` within seconds.

---

#### Task 11 — sendMessage + generateResponse

**Why.** §5f. Heart of the chat feature.

**PREREQUISITE — Task 14 must ship BEFORE Task 11.** Task 11's `sendMessage` mutation calls `acquireThreadLock`, and `generateResponse`'s `finally` calls `releaseThreadLock` — both are defined in Task 14. Ship Task 14 first even though it appears later in the file. (Task numbering is stable to keep cross-refs intact; this is a dependency, not an ordering.)

**Test first.** `convex/chat/__tests__/messages.test.ts`:
- `sendMessage({ threadId, prompt })` inserts a user message with `status: "pending"`, patches `isGenerating: true`; scheduled `generateResponse` runs; assistant row lands with `status: "finished"`; `isGenerating` flips back to `false` (in the action's `finally`).
- **Concurrency gate:** calling `sendMessage` a second time while `isGenerating === true` throws `createError("CONFLICT", …)`.
- **Credits deducted:** after `generateResponse` completes, `creditTransactions` has exactly one new row with `type: "usage"`, `description: "AI: Chat message"`, `metadata.billingType: "chat_llm"`, and `amount` equal to `calculateServerCreditsToDeduct(mockUsage, mockPricing)`.
- **Pre-flight:** when `credits.total < ESTIMATED_CREDITS_PER_CHAT_MESSAGE`, `generateResponse` throws `AI_INSUFFICIENT_CREDITS` AND the `finally` still clears `isGenerating`.

**Implementation.** Per §5f. `generateResponse` resolves the model via `resolveOpenRouterModel(ctx, job.chatModelId)` in `convex/chat/provider.ts` — a thin wrapper around the existing `getProviderModel('openrouter', undefined, modelId, { openrouterProviderOrder: SERVER_AI_CONFIG.openrouterProviderOrder })` from `lib/ai/server/providers.ts`. It returns `{ model, pricing }` so the `usageHandler` doesn't round-trip to fetch pricing again.

**Done when.** Tests green. Manual: posting a message in the chat view shows the user bubble immediately (optimistic), then the assistant streams token by token.

---

#### Task 12 — listThreadMessages query

**Why.** §5d. Drives `useUIMessages` on the client.

**Test first.** `convex/chat/__tests__/messages.test.ts` (same file): returns a `PaginationResult<MessageDoc>` + `streams` via `syncStreams`. With no messages, `page.length === 0`. With one streaming message, `streams` is populated.

**Implementation.** **Critical:** use the standalone `listUIMessages` export (not `paperChat.listMessages`). `useUIMessages` on the client consumes `UIMessage` shape, not `MessageDoc` — feeding it `listMessages` output would silently render nothing.

```ts
import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { components } from "../_generated/api";

export const listThreadMessages = query({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs },
  returns: v.object({
    page: v.array(v.any()),             // UIMessage[] — tighten to a validator when the Agent
                                         // component ships one; `v.any()` is the explicit escape
                                         // hatch here per Convex guidelines.
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    streams: v.any(),                   // syncStreams return — same caveat.
  }),
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});
```

**Done when.** Test green.

---

#### Task 13 — Regenerate + clear + model swap

**Why.** §5g. Three mutations.

**Test first.** `convex/chat/__tests__/messages.test.ts`:
- `regenerateLastAssistant`: when last message is assistant, deletes it and schedules `generateResponse` with the prior user prompt. When last message is user, no-ops.
- `clearThread`: loops until `deleteMessageRange.isDone === true`; thread row survives (via `paperChat.getThreadMetadata`).
- `swapModel({ threadId, modelId })`: patches `chatModelId` on the job row; next `generateResponse` uses the new model.

**Implementation.** Per §5g.

**Done when.** Tests green.

---

#### Task 14 — Concurrency lock + usageHandler + cleanup cron + tier-gated per-user limit

**Why.** §5m, §5n. Replaces the old "rate limiter" task — user directive: no rate limits, just single-in-flight per thread + a cap of N concurrent in-flight chats per user (scaled by subscription tier).

**SHIP THIS BEFORE TASK 11.** Task 11's `sendMessage` and `generateResponse` consume `acquireThreadLock` / `releaseThreadLock` defined here.

**Test first.** `convex/chat/__tests__/concurrency.test.ts` + `agent.test.ts`:
- `acquireThreadLock(jobId)`: patches `isGenerating: true`, `generatingStartedAt: Date.now()`. If already true, throws `CONFLICT`.
- `releaseThreadLock(jobId)`: patches both back to unset. Idempotent — calling on an already-released row is a no-op, not an error.
- `cleanupZombieChatLocks`: given three rows (one fresh lock, one zombie >5 min old, one unlocked), clears only the zombie; fresh + unlocked remain untouched. Logs each clear.
- `usageHandler`: given a synthetic `LanguageModelUsage` + modelId, calls `internal.credits.internal.deductCredits` with `amount === calculateServerCreditsToDeduct(usage, pricing)` and `description: "AI: Chat message"`. Asserts on the resulting `creditTransactions` row shape — `type: "usage"`, `metadata.billingType: "chat_llm"`, `metadata.model`, `metadata.inputTokens`, `metadata.outputTokens`.

**Implementation.**
1. `convex/chat/concurrency.ts` — three mutations per §5m.
2. `convex/chat/provider.ts` — `resolveOpenRouterModel(ctx, modelId)` returns `{ model, pricing }` using existing `getProviderModel('openrouter', undefined, modelId, ...)` and `internal.models.queries.getPricing`.
3. `convex/chat/agent.ts` — `usageHandler` per §5n. **Reuse `calculateServerCreditsToDeduct`** from `convex/ai/helpers.ts`; do NOT duplicate the math. **Reuse `internal.credits.internal.deductCredits`** from `convex/credits/internal.ts`; do NOT invent a new deduction mutation.
4. `convex/crons.ts` — append:
   ```ts
   crons.interval(
     "cleanup zombie chat locks",
     { minutes: 5 },
     internal.chat.concurrency.cleanupZombieChatLocks,
   );
   ```
   (File already registers the 24h OpenRouter sync cron — same pattern.)

**Done when.** Tests green. Manual flow: (1) fire two `sendMessage` back-to-back → second throws `CONFLICT`; (2) wait for first to complete → third succeeds; (3) a single `creditTransactions` row appears per assistant message with `description: "AI: Chat message"` and the exact credit amount from `calculateServerCreditsToDeduct`; (4) simulate a crash (`throw` inside the action between `streamText` and `consumeStream`) → `finally` still releases the lock; (5) force a zombie (patch `isGenerating` manually, wait 6 min) → cron clears it.

---

### Phase E — Chat UI

#### Task 15 — ChatJobView + layout

**Why.** §5j.

**Implementation.**
1. `components/extraction/chat/chat-job-view.tsx`:
   ```tsx
   export function ChatJobView({ job, threadId }) {
     return (
       <TwoColumnLayout
         leftColumn={<PapersInContextSidebar jobId={job._id} />}
         rightColumn={
           <div className="flex h-full flex-col" data-mode="chat">
             <ChatHeader job={job} threadId={threadId} />
             <MessageList threadId={threadId} jobId={job._id} />
             <MessageComposer threadId={threadId} />
           </div>
         }
       />
     );
   }
   ```
2. `app/extraction/[jobId]/page.tsx` main-content slot (around line 730) — add the §5i branch. Hide `<ResultsToolbar>` when `job.mode === "chat"`. Hide tabs when `job.mode === "chat"` (chat has no tab navigation).

**Done when.** Manual: navigating to `/extraction/[chatJobId]` renders the two-column chat layout with placeholder children (Tasks 16–21 fill them in).

---

#### Task 16 — MessageList (AI Elements Conversation + Message + SmoothText)

**Why.** §5j, V1 affordance #1 (streaming indicator) + #8 (optimistic) + #11 (suggestion on empty).

**Test first.** `components/extraction/chat/__tests__/message-list.test.tsx`:
- With `useUIMessages` mocked to return 0 messages, renders `<SuggestionChips>` (empty state).
- With 2 messages, 1 `status === "streaming"`, the streaming row has `data-streaming="true"` + `aria-busy="true"`.
- Assistant message with `[P3]` text resolves to a `<PaperChip index={3}>` element (assert on `data-paper-id`).
- A `failed` message has `data-error="true"` + a retry button with `aria-label="Regenerate response"`.

**Implementation.**
1. Wire `useUIMessages(api.chat.messages.listThreadMessages, { threadId }, { initialNumItems: 20, stream: true })`.
2. Use AI Elements `<Conversation>` as the outer autoscroll container, `<ConversationContent>` inside.
3. Render each message via AI Elements `<Message from={m.role}>` + `<MessageContent>` + `<MessageResponse>` (Streamdown renderer). Add:
   - `<MessageActions>` with `<MessageAction>` for copy + retry on assistant messages (Task 18).
   - `data-role`, `data-status`, `data-streaming`, `data-error` on the message row.
4. Streamdown plugin for paper-chip resolution: `remarkPlugins: [remarkPaperChips(papers)]`. `remarkPaperChips` transforms `[P3]` text nodes into a custom `paperChip` node that the `streamdown` component renderer maps to our `<PaperChip>`.
5. Empty state (0 messages): render `<SuggestionChips>` (Task 17).

**Done when.** Tests green. Manual: sending a message streams tokens in place; `[P3]` references render as interactive chips with hover-card.

---

#### Task 17 — SuggestionChips (AI Elements Suggestion)

**Why.** V1 affordance #11.

**Test first.** `components/extraction/chat/__tests__/suggestion-chips.test.tsx`:
- Renders 4 suggestion chips with `role="button"`.
- Clicking one calls `onSelect(text)`.

**Implementation.**
1. `components/extraction/chat/suggestion-chips.tsx` — 4 curated prompts: "Summarise these papers", "What are the shared themes?", "Which paper is most cited?", "Compare methodology across papers".
2. Wrap AI Elements `<Suggestions>` + `<Suggestion>`. `onSelect` calls `sendMessage({ threadId, prompt })` via the composer's mutation.

**Done when.** Test green.

---

#### Task 18 — MessageActions (copy + retry)

**Why.** V1 affordances #2 + #3.

**Test first.** `components/extraction/chat/__tests__/message-actions.test.tsx`:
- Copy button writes the message text to `navigator.clipboard`.
- Copy button is `aria-disabled="true"` when `message.status === "streaming"`.
- Retry button fires `regenerateLastAssistant` mutation, only visible on the last assistant message OR a failed message.

**Implementation.**
1. `components/extraction/chat/message-actions.tsx` — wraps AI Elements `<MessageActions>` + `<MessageAction>`.
2. Copy handler: joins `message.parts` text parts, `navigator.clipboard.writeText(text)`, toasts "Copied".
3. Retry handler: calls `useMutation(api.chat.messages.regenerateLastAssistant)({ threadId })`. Visible only when `isLastAssistant || message.status === "failed"`.

**Done when.** Tests green. Manual: copy and retry both work; copy disabled during streaming.

---

#### Task 19 — MessageComposer (PromptInput + Cmd+Enter + optimistic)

**Why.** V1 affordances #4 + #8.

**Test first.** `components/extraction/chat/__tests__/message-composer.test.tsx`:
- Typing + pressing Cmd+Enter fires `sendMessage({ threadId, prompt: text })`.
- Plain Enter inserts a newline, does NOT submit.
- Submit button is disabled when `text.trim() === ""`.
- Optimistic mutation fires with `withOptimisticUpdate(optimisticallySendMessage(...))`.

**Implementation.**
1. `components/extraction/chat/message-composer.tsx` — wraps AI Elements `<PromptInput>` + `<PromptInputTextarea>` + `<PromptInputSubmit>`.
2. `useMutation(api.chat.messages.sendMessage).withOptimisticUpdate(optimisticallySendMessage(api.chat.messages.listThreadMessages))`.
3. Key handler (already patched in Task 2): submit on `Cmd/Ctrl + Enter`.

**Done when.** Tests green.

---

#### Task 20 — PapersInContextSidebar

**Why.** V1 affordance #6.

**Test first.** `components/extraction/chat/__tests__/papers-in-context-sidebar.test.tsx`:
- Renders one row per `extractionJobSources` entry.
- Clicking a row opens a `<Sheet>` containing the full abstract.
- On mobile viewport (jsdom simulation), the sidebar is closed by default.

**Implementation.**
1. `useQuery(api.extraction.queries.getJobSources, { jobId })` (new query — if not present, add it; similar to existing per-job queries).
2. Desktop: `<Collapsible open defaultOpen>` + `<ScrollArea>`.
3. Mobile: trigger button + `<Sheet side="right">` containing the same content.
4. Per-paper row: reuse `<SourceChip>` from P6/P8 (the bucket chip component). `data-paper-id`.

**Done when.** Tests green.

---

#### Task 21 — ChatHeader (model picker + clear)

**Why.** V1 affordances #5 + #10.

**Test first.** `components/extraction/chat/__tests__/chat-header.test.tsx`:
- Model picker shows the current model, lists all `isServed` models.
- Changing model fires `swapModel` + toasts "Model changed — prompt cache reset".
- Clear button opens an `AlertDialog`; confirming fires `clearThread`.

**Implementation.**
1. `components/extraction/chat/chat-header.tsx`:
   ```tsx
   <header className="flex items-center justify-between border-b p-4">
     <h1 className="text-lg font-medium">{job.name}</h1>
     <div className="flex items-center gap-2">
       <ModelPicker value={job.chatModelId} onChange={(id) => swapModel({ threadId, modelId: id })} />
       <ClearConversation threadId={threadId} />
     </div>
   </header>
   ```
2. `ModelPicker` reused from Task 6.
3. `ClearConversation` wraps shadcn `<AlertDialog>` + confirmation copy.

**Done when.** Tests green.

---

#### Task 22 — Error state + failed-message banner

**Why.** V1 affordance #7.

**Test first.** `components/extraction/chat/__tests__/message-list.test.tsx` (extend): a `failed` message renders `<Alert variant="destructive">` inline + retry button.

**Implementation.**
1. Inside `<MessageList>`, when `message.status === "failed"` and `message.parts` is empty (stream died immediately), render `<Alert variant="destructive">` with `message.metadata?.error ?? "Response failed"`.
2. Retry button is the same as MessageActions' retry (Task 18).

**Done when.** Test green.

---

### Phase F — Results page + history list polish

#### Task 23 — Results-page mode branch

**Why.** §5i.

**Test first.** `app/extraction/[jobId]/__tests__/page.test.tsx`: given `job.mode === "chat"`, renders `<ChatJobView>` and NOT `<ResultsToolbar>`, `<Tabs>`. Given `job.mode === "extraction"`, existing behaviour preserved.

**Implementation.**
1. `app/extraction/[jobId]/page.tsx` — single conditional at main content (§5i). Also suppress the view-mode toolbar and the tabs block when chat. Wrap the tabs block (lines 662–726 + 730–986) in `{job.mode === "extraction" && ( ... )}`.
2. When chat: skip the `nuqs` query-state subscriptions for `activeTab` and `viewMode` — they're never used. (The project uses `nuqs` for URL-synced state, not a custom `useUrlState` hook.)

**Done when.** Test green. Manual: navigating between an extraction job and a chat job works both ways; URL state is scoped per mode (no cross-mode leakage).

---

#### Task 24 — Job card: mode badge + chat subline

**Why.** §5o.

**Test first.** `components/extraction/__tests__/job-list-item.test.tsx`:
- Extraction job renders a `<Badge>Extraction</Badge>` with `data-mode="extraction"` + subline "{N} papers · {status} · {relativeTime}".
- Chat job renders a `<Badge>Chat</Badge>` with `data-mode="chat"` + subline "{N} papers · {messageCount} messages · {lastMessageAt-relative}".

**Implementation.**
1. `components/extraction/job-list-item.tsx` — add mode badge block near line 88. Add chat subline branch near line 96/120.
2. Both use shadcn `<Badge>` with `variant="secondary"` for chat, `variant="default"` for extraction.
3. Row root: `data-mode={job.mode}` for behavioural testing.

**Done when.** Test green.

---

#### Task 25 — Unified list query + sort

**Why.** §5o.

**Test first.** `convex/extraction/__tests__/queries-jobs.test.ts`: given 3 extraction + 2 chat jobs for the same user, `listJobs` returns them interleaved by `updatedAt DESC`.

**Implementation.**
1. `convex/extraction/queries/jobs.ts` `listJobs` — switch from `by_user_status` to `by_user_mode_updated` (use just the `userId` prefix) + `.order("desc")` by `updatedAt`.
2. The server query accepts an optional `mode?: "extraction" | "chat"` filter for a future filter UI; defer the UI filter.

**Done when.** Test green.

---

### Phase G — A11y + polish

#### Task 26 — aria-live, data-attrs, focus restoration

**Why.** §5p + CLAUDE.md testing rules.

**Test first.** `components/extraction/chat/__tests__/a11y.test.tsx`:
- MessageList container has `role="log"` + `aria-live="polite"` + `aria-relevant="additions"`.
- Streaming assistant bubble has `aria-busy="true"` during streaming, flips to `false` after.
- Clearing a conversation returns focus to the composer textarea.
- Mode selector radio cards each have `role="radio"` + `aria-checked` reflecting state.

**Implementation.** Wire the attributes per §5p throughout the components added in Phase E.

**Done when.** Test green; manual VoiceOver check: message additions are announced after full completion (not per-token).

---

#### Task 27 — Pure logic unit tests

**Why.** CLAUDE.md testing rule — push pure logic out of render.

**Implementation.** Three unit test files in `lib/chat/`:
- `tests/lib/chat/resolve-paper.test.ts` — `resolvePaperReference(text, papers)` returns correct offsets + paper lookup; out-of-range index returns `null` paper; no-match text returns empty array.
- `tests/lib/chat/render-corpus.test.ts` — `renderPaperCorpus(papers)` produces byte-deterministic output; missing-abstract paper renders `<abstract>(no abstract available)</abstract>`.
- `tests/lib/chat/credit-cost.test.ts` — `calculateServerCreditsToDeduct(usage, pricing)` matches extraction's current math for the usage shapes Agent's `usageHandler` emits.
- `tests/lib/chat/optimistic-message.test.ts` — `buildOptimisticUserMessage(threadId, prompt)` returns UIMessage shape with `role: "user"`, `status: "pending"`, `parts: [{ type: "text", text: prompt }]`, stable ID prefix.

**Done when.** All three test files green; no test file in this plan asserts on CSS classes.

---

## 7. Migration & destructiveness checklist

- [ ] `@convex-dev/agent` installed; `convex.config.ts` registers it. **Rate limiter NOT installed** — OpenRouter is the provider, no frequency gating.
- [ ] OpenRouter + Agent compatibility probe (Task 1) passed, or fallback to raw `streamText` documented.
- [ ] AI Elements installed at `components/ai-elements/*`; user-bubble + Cmd+Enter post-install patches applied; unused streamdown plugins pruned.
- [ ] `extractionJobs` schema adds `mode`, `usePdfs`, `chatThreadId`, `chatModelId`, `lastMessageAt`, `messageCount`, `isGenerating`, `generatingStartedAt`; existing mandatory fields become optional.
- [ ] `by_user_mode_updated` and `by_chatThread` indexes added.
- [ ] Backfill migration run; every existing row has `mode: "extraction"`.
- [ ] Feature flag `extraction.chat` registered (default OFF).
- [ ] `getPdfExtractionEnabledInternal` removed (replaced by per-job `usePdfs`).
- [ ] `startExtraction`, `startExtractionFromTemplate`, `duplicateExtraction` removed; `startJob`, `startJobFromTemplate`, `duplicateJob` ship.
- [ ] Every call site updated; `grep -r "startExtraction\b" .` returns 0.
- [ ] `useExtractionStore` extended with `mode`, `chatModelId`, `usePdfs`; `JobCreator` renders mode-aware step 1, 2, 3.
- [ ] Chat backend (`convex/chat/*`) ships: `agent`, `threads`, `messages`, `concurrency`, `provider`, `context`, `model`. `cleanupZombieChatLocks` cron registered on a 5-minute interval in `convex/crons.ts`.
- [ ] All six V1 AI Elements components installed + wired.
- [ ] `ChatJobView` + children: MessageList, MessageComposer, MessageActions, PapersInContextSidebar, ChatHeader, SuggestionChips, PaperChip, ClearConversation — all land.
- [ ] `app/extraction/[jobId]/page.tsx` branches on `job.mode`; chat hides tabs + toolbar.
- [ ] `job-list-item.tsx` renders mode badge + mode-aware subline; list sort uses `updatedAt`.
- [ ] `models.category` unchanged; picker filters by `isServed === true`.
- [ ] Concurrency gate active: a second `sendMessage` while the first is streaming throws `createError("CONFLICT", …)`.
- [ ] `usageHandler` calls `internal.credits.internal.deductCredits` (verified real path) using `calculateServerCreditsToDeduct` — zero divergence from extraction's billing math. Produces one `creditTransactions` row per assistant message with `description: "AI: Chat message"`.
- [ ] Pre-flight credit check in `generateResponse` throws `AI_INSUFFICIENT_CREDITS` via `internal.credits.internal.getBalanceByUserId` — matches extraction's `waitAndExtractAction` pattern.
- [ ] All LLM calls route through `getProviderModel('openrouter', …)` from `lib/ai/server/providers.ts`. No direct provider SDKs (`@ai-sdk/anthropic`, `@ai-sdk/openai`) introduced. No AI Gateway.
- [ ] `knip` dead-code report clean.
- [ ] Full test suite green at every commit.

---

## 8. Files inventory

### Modified

- `convex/schema.ts` — `extractionJobs` delta (§5a) + indexes.
- `convex/convex.config.ts` — `app.use(agent)`.
- `convex/crons.ts` — register `cleanupZombieChatLocks` (5-minute interval).
- `convex/lib/constants.ts` — add `ESTIMATED_CREDITS_PER_CHAT_MESSAGE` (mirrors `ESTIMATED_CREDITS_PER_QUERY`).
- `convex/extraction/mutations/jobs.ts` — `startJob` replaces `startExtraction`.
- `convex/extraction/mutations/templates.ts` — `startJobFromTemplate`.
- `convex/extraction/mutations.ts` (barrel) — re-exports.
- `convex/extraction/validators.ts` — `startJobArgs`.
- `convex/extraction/workflow.ts` — reads `job.usePdfs`.
- `convex/extraction/workpoolActions.ts` — reads `job.usePdfs`.
- `convex/extraction/queries/jobs.ts` — `listJobs` sorts by `updatedAt`.
- `convex/extraction/mutations/internal/onComplete.ts` — any `startExtraction` references become `startJob`.
- `convex/extraction/public-api-routing.test.ts` — cover both modes.
- `app/extraction/[jobId]/page.tsx` — mode branch at main content; hide toolbar/tabs when chat.
- `components/extraction/job-creator.tsx` — mode-aware steps 1/2/3; `startJob` call.
- `components/extraction/job-list-item.tsx` — mode badge + chat subline.
- `components/extraction/report-builder.tsx` — `duplicateJob` instead of `duplicateExtraction`.
- `components/extraction/results-views/table-view.tsx` — read `job.usePdfs` (not flag).
- `components/ai-elements/message.tsx` — user-bubble primary colour; trimmed plugins.
- `components/ai-elements/prompt-input.tsx` — Cmd+Enter keybind.
- `lib/store/extraction.ts` — `mode`, `chatModelId`, `usePdfs` + setters.
- `lib/feature-flags/registry.ts` — add `extraction.chat` flag.

### New — Convex

- `convex/chat/agent.ts` — `paperChat` instance + `usageHandler`.
- `convex/chat/threads.ts` — `ensureThreadForJob`, `authorizeThreadAccess`, `getThreadMetadataForJob`, `getModelForThread`.
- `convex/chat/messages.ts` — `sendMessage`, `generateResponse`, `listThreadMessages`, `regenerateLastAssistant`, `clearThread`.
- `convex/chat/context.ts` — `buildSystemPromptForJob`, `renderPaperCorpus`.
- `convex/chat/model.ts` — `swapModel`, `listChatModels`.
- `convex/chat/concurrency.ts` — `acquireThreadLock`, `releaseThreadLock`, `cleanupZombieChatLocks`.
- `convex/chat/provider.ts` — `resolveOpenRouterModel(ctx, modelId)` (wraps existing `getProviderModel`).
- `convex/migrations/setExistingJobsToExtractionMode.ts` — one-off backfill.

### New — UI (under `components/extraction/`)

- `components/extraction/mode-selector.tsx`
- `components/extraction/pdf-toggle.tsx`
- `components/extraction/model-picker.tsx`
- `components/extraction/chat/chat-job-view.tsx`
- `components/extraction/chat/chat-header.tsx`
- `components/extraction/chat/clear-conversation.tsx`
- `components/extraction/chat/message-list.tsx`
- `components/extraction/chat/message-composer.tsx`
- `components/extraction/chat/message-actions.tsx`
- `components/extraction/chat/papers-in-context-sidebar.tsx`
- `components/extraction/chat/suggestion-chips.tsx`
- `components/extraction/chat/chat-start-review.tsx`
- `components/extraction/chat/paper-citation.tsx`
- `components/extraction/chat/abstract-missing-banner.tsx`

### New — AI Elements (copied by shadcn CLI)

- `components/ai-elements/conversation.tsx`
- `components/ai-elements/message.tsx`
- `components/ai-elements/prompt-input.tsx`
- `components/ai-elements/shimmer.tsx`
- `components/ai-elements/inline-citation.tsx`
- `components/ai-elements/suggestion.tsx`
- (+ transitive shadcn primitives in `components/ui/`: `button-group`, `input-group`, `command`, `hover-card`, `carousel`, `collapsible`, `spinner`.)

### New — lib

- `lib/chat/resolve-paper.ts` — `resolvePaperReference(text, papers)`: returns `{ start, end, index, paper }[]` for every `[P{n}]` match. Pure, unit-tested.
- `lib/chat/render-corpus.ts` — `renderPaperCorpus(papers)`.
- `lib/chat/optimistic-message.ts` — `buildOptimisticUserMessage(threadId, prompt)` — pure builder for the synthetic UIMessage inserted by `withOptimisticUpdate` in the composer (Task 19). Unit-tested.

### New — tests

- `convex/chat/__tests__/agent.test.ts`
- `convex/chat/__tests__/threads.test.ts`
- `convex/chat/__tests__/messages.test.ts`
- `convex/chat/__tests__/context.test.ts`
- `convex/chat/__tests__/concurrency.test.ts`
- `convex/chat/__tests__/provider.test.ts`
<!-- compat probe removed — OpenRouter V3 passes Agent's AssertAISDKv6 type guard; verified in Task 1 rewrite -->
- `convex/__tests__/schema.test.ts` (extend)
- `components/extraction/__tests__/job-creator.test.tsx` (extend)
- `components/extraction/__tests__/job-list-item.test.tsx`
- `components/extraction/chat/__tests__/message-list.test.tsx`
- `components/extraction/chat/__tests__/message-composer.test.tsx`
- `components/extraction/chat/__tests__/message-actions.test.tsx`
- `components/extraction/chat/__tests__/papers-in-context-sidebar.test.tsx`
- `components/extraction/chat/__tests__/chat-header.test.tsx`
- `components/extraction/chat/__tests__/suggestion-chips.test.tsx`
- `components/extraction/chat/__tests__/a11y.test.tsx`
- `app/extraction/[jobId]/__tests__/page.test.tsx`
- `tests/lib/chat/resolve-paper.test.ts`
- `tests/lib/chat/render-corpus.test.ts`
- `tests/lib/chat/credit-cost.test.ts`
- `tests/lib/chat/optimistic-message.test.ts`
- `lib/store/__tests__/extraction.test.ts` (extend)

**Test-placement convention** (verified against the codebase, CLAUDE.md-compliant):
- Convex tests: `convex/**/__tests__/*.test.ts`
- React component tests: `components/**/__tests__/*.test.tsx`
- Zustand store tests: `lib/store/__tests__/*.test.ts`
- Pure-logic `lib/` tests: **`tests/lib/**/*.test.ts`** (parallel tree, not colocated — verified against existing `tests/lib/effective-paper-count.test.ts`, `tests/lib/card-thresholds.test.ts`, `tests/library/trim-paper-data.test.ts`, `tests/ai-cost.test.ts`, `tests/answer-grouping.test.ts`).

Vitest with `import { describe, it, expect } from "vitest"`; `describe` > `it` (not `test`); inline fixtures (no `__fixtures__/` directories); edge cases as separate `it` blocks (not nested); `toBeCloseTo` for floats; no snapshot tests in pure-logic.

### Deleted

- `convex/extraction/queries/internal.ts::getPdfExtractionEnabledInternal` — replaced by per-job `usePdfs`.
- `convex/extraction/mutations/jobs.ts::startExtraction` — replaced by `startJob`.
- Any `useFeatureFlag("extraction.pdf")` call site that now reads `job.usePdfs` instead (5-ish sites).

---

## 9. Test strategy

- **Convex-side** (Tasks 3, 4, 5, 9–14): use `convex-test` harness. Seed a user + job + papers. Call mutations; assert schema / subsequent-query shape. Every action test schedules via `ctx.scheduler.runAfter(0, ...)` and awaits completion via the harness's tick helper.
- **Unit** (Task 27): `resolvePaperById`, `renderPaperCorpus`, `creditCostFromUsage` — pure functions; vitest against fixtures.
- **Component** (Tasks 6–8, 15–24): React Testing Library + jsdom. Mock `useUIMessages` via a stub that returns controlled results + stream states. Assert on `role`, `aria-*`, `data-*` — never on classes. For Streamdown-rendered content, assert on textContent + the presence of `data-paper-id` on resolved chips.
- **A11y** (Task 26): same harness; assert `role="log"`, `aria-live`, `aria-busy`, focus targets after confirmation dialogs.
- **Visual regression**: not in P9 scope. If/when VRT is wired project-wide, chat mode is a natural candidate.

Baseline from earlier plans (P6 §9, P8): the suite is green at HEAD. Every commit in this plan leaves it green or adds tests that do.

---

## 10. Open items (flag to user before starting)

1. **~~Mid-stream abort / "Stop generating" button.~~ RESOLVED — ship in V1 (user confirmed).** Implementation: add `shouldAbort: v.optional(v.boolean())` to `extractionJobs` in the §5a schema delta. `generateResponse` polls the flag at each stream chunk via `ctx.runQuery(internal.chat.threads.shouldAbortInternal, { threadId })`; on `true`, calls `result.abort()` from the AI SDK and returns. A new `abortGeneration` public mutation sets the flag + only works while `isGenerating === true`. Task 22b (new) ships the Stop button in the composer toolbar next to the streaming indicator (shown only during `status === "streaming"`).

2. **`extraction.chat` flag default.** §5q says OFF. That hides the entire chat path from non-dev users while we harden it. If the user wants to ship with chat **visible** on day one, flip the default to `true` and merge with the feature flag set to on in production. Default: **OFF**, flip on post-QA.

3. **Chat-mode templates.** §5c's `startJobFromTemplate` preserves the existing extraction template flow. Chat templates are an ask: "save this paper set + model + suggested prompts as a reusable chat template." Default: **out of V1; add `mode` column to the templates table in a follow-up.**

4. **Concurrency scope.** §5m is **per chat thread** (one in-flight generation per thread). Alternative: **per user** (only one active generation across all the user's chat threads). Per-thread lets a user run two chats in parallel in two tabs; per-user is simpler but restrictive. Default: **per-thread** — matches user's "one at a time" directive (read as per-chat, not per-account).

5. **Model picker default.** User said "just take the first one on the list". §5c implements this via `defaultChatModelId(ctx)` which reads `models` filtered by `isServed: true` ordered by `sortOrder ASC` and picks the first. If the expectation is "use Sonnet 4.6 regardless of what happens to be first", add a hardcoded fallback in `defaultChatModelId`. Default: **first `isServed`**, because the user said so.

6. **Abstract-missing threshold.** §7 Task 7 always shows the banner when >0 papers are missing abstracts. Alternative: only show when >20% are missing. Default: **always when >0**; the banner is low-signal if it fires every time but we don't want silent degradation.

7. **PaperChip hover-card content.** The chip shows title + authors + year by default. Could also show the abstract (long-form) and a DOI link. Default: **title + authors + year + a "View details" button that opens the same `<Sheet>` as the sidebar.** Anything beyond that is a V2 concern.

8. **`paperSets` shared abstraction.** Deferred per §1 out-of-V1. If the user ever asks "Chat about the papers from this extraction job", the shortest path is a new mutation `forkJobForChat({ sourceJobId })` that reads `extractionJobSources` of the source and writes them into a new chat job. No schema change needed. Default: **defer until asked.**

9. **Observability / tracing.** Agent supports a tracing hook for OTEL. The project doesn't currently emit traces. Default: **skip for V1**; the `usageHandler` logs usage per message, which is enough for billing correctness. Add OTEL when observability lands project-wide.

10. **`extractionJobs` rename.** Cosmetic. "extraction" is now the wrong name for a table that holds chat jobs too. Default: **defer**; requires migrating 30+ imports in one go. Schedule P10 ("Rename extractionJobs → jobs") as a pure-mechanical followup once this ships.

11. **Pre-flight credit buffer.** §5n uses `ESTIMATED_CREDITS_PER_CHAT_MESSAGE`, a new constant seeded at ~200 credits (extraction uses `ESTIMATED_CREDITS_PER_QUERY` similarly). Under-estimating lets a user with just-enough credits trigger the LLM but fail deduction (lifetime accounting drift). Over-estimating locks users out of short messages. Default: **mirror extraction's constant**; revisit after a week of usage logs.

12. **Prompt caching re-enable trigger.** Currently DISABLED in V1 (§4i). Add caching back to §5e's second system message the moment `@openrouter/ai-sdk-provider` ships a v6-stable release that forwards `cache_control` through the Responses path — or, if OpenRouter pivots back to the Chat Completions path in a later patch. Until then: every turn pays full input rate on the 20k-token corpus (~$0.06/turn at Sonnet 4.5). Track upstream issues #35 and #389 on github.com/OpenRouterTeam/ai-sdk-provider.

None of these are blockers. Start at Task 1.
