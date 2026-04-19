# Copy-Paste Execution Prompts

One prompt per plan. Paste into a **fresh Claude Code session** (`/clear` first). Each is self-contained — the session does not need prior conversation context.

The prompts all share the same standing rules — copy only the one you want to execute.

> **Migration stance for every prompt:** Dev data is disposable. No schema changes in this plan set, but if you ever find an index mismatch or orphan row, wipe via Convex dashboard. Do NOT write backfill scripts. Do NOT add compat shims. See `00-README.md` § Migration stance.
>
> **Delegation policy for every prompt:** Delegate broadly to subagents to protect this session's context. Any investigation needing >3 file reads or >3 greps → spawn an Agent (`Explore` for codebase mapping, `general-purpose` for research). Batch independent subagents in a single message for parallelism. The main session owns the TDD cycle, commits, and plan-file edits; everything else is delegable. See `00-README.md` § Delegation policy.

---

## Prompt — Plan 01 (Action-Side Abort Wiring)

```
You are executing plan 01 of the chat-stop-streaming effort for the openalex-count project.
Plan file: plans/chat-stop-streaming/01-action-abort-wiring.md
Context README: plans/chat-stop-streaming/00-README.md

This is a long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document your choice in the commit message.

STANDING RULES
1. DRY — `job.shouldAbort` field, `abortGeneration` mutation, `shouldAbortInternal` query, and `releaseThreadLock` mutation all already exist. This plan adds the ONE missing consumer (the poller). Do not rebuild any of those. Read them and extend.
2. NO LEGACY — this project is pre-testing. Never keep old fields "just in case", never add compat shims. If you find dead code next to what you touch, delete it.
3. CONVEX GUIDELINES OVERRIDE TRAINING — read convex/_generated/ai/guidelines.md before any Convex code. Re-read when uncertain.
4. TESTING DOCTRINE (CLAUDE.md) — assert on behavior, ARIA, data-*. Never CSS classes or Tailwind strings.
5. RESEARCH BEFORE GUESSING — the @convex-dev/agent library's streamText signature and DeltaStreamer internals are documented in the plan's § Design section with exact file_path:line anchors in node_modules. Read the actual library source if any doubt. Use convex-* skills via Skill(find-skills) for anything Convex-specific you're unsure of. NEVER hallucinate APIs.
6. DELEGATE — any investigation >3 file reads or >3 greps → spawn an Agent. Batch parallel research in one message.

Schema: no changes in this plan. `shouldAbort` field already exists on extractionJobs. If you catch yourself wanting to add a schema field, re-read § D3 and § D7 of the README.

EXECUTION RHYTHM
Phase A (TDD — pure logic only):
  lib/chat/abort-poller.ts  (R1–R8, commit per green)
  Use vi.useFakeTimers(). Watch red, implement minimum, watch green, commit.
  Refactor step only if the `fired` + `stopped` guards can merge without loss of clarity.

Phase B (test-after — action wiring + Convex integration tests):
  1. Refactor convex/chat/messages.ts::generateResponse per § 3 of the plan. Single commit.
     Specifically: construct AbortController, start poller, pass abortSignal into paperChat.streamText's 3rd arg, set maxRetries: 0, wire onAbort, stop poller in finally before releaseThreadLock.
  2. Delete or rewrite the stale comment on schema.ts:374-376 about shouldAbort. Single commit.
  3. Write Convex integration tests A1–A8 in convex/chat/messages.test.ts. Commit per unit.
  4. Write credit test C1. If usageHandler does not fire on abort, follow the § Deviations fallback.
  5. Live smoke test in browser. Document results in commit message.

COMMIT DISCIPLINE
- Conventional-commit prefix: feat, fix, refactor, test, chore, docs.
- Scope every commit with [plan-01].
- Never commit if tests are red.
- Never use --no-verify.
- Do not push to remote.

WHEN TO STOP
Stop ONLY when every acceptance-criterion checkbox in the plan file is satisfied AND all tests are green AND the live smoke test passes. Write a one-paragraph summary of what landed.

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, an impulse to "check with the user".

If you hit a real blocker, commit progress, write plans/chat-stop-streaming/01-BLOCKER.md, and stop.

DEVIATIONS
If the plan is wrong or incomplete:
1. Stop coding.
2. Edit the plan file directly (specifically the § Deviations section lists the 4 known risks).
3. Commit the plan edit first (chore(plan-01): update after discovering X).
4. Then resume code execution against the corrected plan.

The plan's § Known pitfalls section enumerates 8 specific gotchas. Re-read them before starting.
```

---

## Prompt — Plan 02 (Aborted UI State)

```
You are executing plan 02 of the chat-stop-streaming effort for the openalex-count project.
Plan file: plans/chat-stop-streaming/02-aborted-ui-state.md
Context README: plans/chat-stop-streaming/00-README.md

This is a medium-length autonomous task. Expect 1-3 hours. Plan 01 MUST have landed first — verify by running `git log --oneline | grep plan-01` and confirming backend abort wiring is present in convex/chat/messages.ts::generateResponse. If not, STOP and notify the user.

STANDING RULES
1. DRY — the project uses `sonner` for toasts (verify; if not, swap). Message-list and message-actions already exist. `@convex-dev/agent`'s `listThreadMessages` already exposes streaming state. Read and extend; do not rewrite.
2. NO LEGACY — this project is pre-testing. Delete dead code when you touch nearby files.
3. TESTING DOCTRINE (CLAUDE.md) — assert on ARIA, data-*, visible text. NEVER CSS classes or Tailwind strings. If a test reaches for `.toMatch(/text-/)` or `.toHaveClass(...)`, fix the source to expose a `data-*` attribute instead.
4. RESEARCH BEFORE GUESSING — the message shape returned by `listThreadMessages` may not literally expose `state.kind === "aborted"` — verify against node_modules/@convex-dev/agent. Read the library type before writing the predicate. One Agent(Explore, "very thorough") spawn saves an hour.
5. DELEGATE — any investigation >3 file reads or >3 greps → spawn an Agent. Batch parallel research in one message.
6. i18n — every user-visible string must be in messages/*.json for all project locales. Grep existing chat keys for naming convention before adding new ones.

Schema: no changes in this plan.

EXECUTION RHYTHM

Phase A (research + verify — 15min):
  Spawn an Explore agent with prompt: "Read node_modules/@convex-dev/agent/src/client/index.ts around listThreadMessages and the message type it returns. Tell me the exact field name + type for the discriminator that indicates an aborted stream. Also identify whether syncStreams's includeStatuses defaults include 'aborted'. Cite line numbers." Wait for result before coding.

  Also read:
    - components/extraction/chat/message-list.tsx
    - components/extraction/chat/message-actions.tsx
    - components/extraction/chat/message-composer.tsx (handleStop at L57-61 — the plan's anchor)
    - components/extraction/chat/streaming-cursor.tsx (the pitfall in § Known pitfalls)

Phase B (implementation, test-after):
  1. Add `chat.stop.toast`, `chat.stop.toastFailure`, `chat.abortedPill.label`, `chat.abortedPill.aria` to messages/en.json and every other locale. One commit.
  2. Create components/extraction/chat/aborted-pill.tsx per § 1 Surface B. One commit.
  3. Update message-composer.tsx handleStop to fire toasts on resolve/reject. One commit.
  4. Update message-list.tsx to conditionally render <AbortedPill /> for aborted assistant messages. Use the exact discriminator from Phase A research. Add data-message-state="aborted" to the message row container. One commit.
  5. Loosen retry disabled predicate in message-actions.tsx per § Surface C. One commit.
  6. If listThreadMessages/syncStreams doesn't include "aborted" status, add it. One commit.
  7. Write Testing Library tests B1–B7 + Convex integration test M1. Commit per test.
  8. Live E2E smoke test in browser (desktop + mobile viewport). Document in commit.

COMMIT DISCIPLINE
- Conventional-commit prefix: feat, fix, refactor, test, chore, docs.
- Scope every commit with [plan-02].
- Never commit if tests are red.
- Never use --no-verify.
- Do not push to remote.

WHEN TO STOP
Stop ONLY when every acceptance-criterion checkbox in the plan file is satisfied AND all tests are green AND the E2E smoke test passes on both desktop and mobile viewports. Write a one-paragraph summary of what landed.

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, an impulse to "check with the user".

If you hit a real blocker, commit progress, write plans/chat-stop-streaming/02-BLOCKER.md, and stop.

DEVIATIONS
The plan's § Deviations section lists 4 known risks. If any trigger:
1. Stop coding.
2. Edit the plan file (specifically § Deviations + the affected design section).
3. Commit the plan edit first (chore(plan-02): update after discovering X).
4. Then resume code execution.

The plan's § Known pitfalls section lists 6 specific gotchas. Re-read before starting.
```

---

## Standing rules referenced by both prompts

These are already inline above; this section is for reference so the rules are in one place.

### DRY

- The backend has `job.shouldAbort`, `abortGeneration`, `shouldAbortInternal`, `releaseThreadLock`, `cleanupZombieChatLocks`, and `paperChat.streamText` all ready. Plan 01 wires the loop.
- The frontend has `message-composer.tsx::handleStop`, `sonner` toasts, `message-list.tsx`, `message-actions.tsx`, `streaming-cursor.tsx`, and `listThreadMessages` all ready. Plan 02 surfaces state.
- If you find yourself writing a new mutation, a new query, a new schema field, or a new top-level component, **stop and re-read the plan**.

### NO LEGACY

- Delete the stale comment at `convex/schema.ts:374-376` when plan 01 lands. It will finally be accurate if rewritten; or just delete it since the caller is self-evident.
- Do not preserve the `shouldAbortInternal` query's "unused" state — once plan 01 lands, it has one caller. That's enough.
- Do not add `// TODO: handle abort` comments anywhere. Either handle it in this plan set, or it's out of scope.

### CONVEX GUIDELINES OVERRIDE TRAINING

`convex/_generated/ai/guidelines.md` is ground truth for Convex patterns. Read before writing any Convex code. Particularly:
- Action runtime semantics (1-shot imperative, no reactivity).
- `ctx.runQuery` / `ctx.runMutation` usage inside actions.
- Validators (v.id, v.optional, v.boolean).
- Why `ctx.scheduler.cancel` doesn't kill running actions.

### TESTING DOCTRINE (CLAUDE.md)

**Assert on behavior, not source.** Never:
- `expect(el.className).toMatch(/text-/)`
- `expect(el).toHaveClass("flex-col", ...)`
- `expect(el.style.backgroundColor).toBe(...)`

Always:
- `getByRole("status")`, `getByRole("button", { name: /regenerate/i })`
- `toHaveTextContent(/stopped/i)`
- `[data-message-state="aborted"]` selectors
- Unit tests for pure logic in `lib/**.test.ts`.

Pure logic out of components, visible state surfaced as `data-*` or ARIA, render-only components tested against ARIA tree.

### RESEARCH BEFORE GUESSING

- `@convex-dev/agent` internals: read `node_modules/@convex-dev/agent/src/client/streamText.ts` and `streaming.ts` when in doubt about streamText args, DeltaStreamer abort, or the message-state discriminator.
- AI SDK v6: read `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx` for the `streamText` option reference (including `abortSignal`, `onAbort`, `maxRetries`).
- OpenRouter: read `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs` around `doStream` if you suspect signal propagation is broken.

The plan's § Design sections cite exact file_path:line anchors. Use them.

### DELEGATE

- Any investigation needing > 3 file reads or > 3 greps → spawn an Agent. Batch parallel research in a single message with multiple Agent tool calls.
- `Explore` for codebase ("find all callers of X"), `general-purpose` for research ("read these 3 library docs, summarize").
- Keep the main session focused on: TDD cycles, commits, plan-file edits, acceptance-criteria verification.

### i18n

- `messages/en.json` + every other locale must have matching keys.
- Grep existing keys: `rg -l "chat\\." messages/` — follow the existing scheme.
- Do not hardcode English strings in components. Every user-visible string passes through `useTranslations()`.
