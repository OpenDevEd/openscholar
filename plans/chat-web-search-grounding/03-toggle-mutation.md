# 03 — Public mutation `setChatWebSearchEnabled`

## Goal

Provide the single public Convex mutation that the composer toggle (plan 07) calls to flip `extractionJobs.webSearchEnabled` for a chat thread. Auth-gated, idempotent, and runs the same authorization check as the rest of the chat mutations so users cannot toggle other people's threads.

## Scope

In:
- `convex/chat/messages.ts`: new exported public `mutation({ args: { threadId: v.string(), enabled: v.boolean() }, handler })`. Likely placed near `swapModel` (an existing per-thread setter).
- Test extension in `convex/chat/messages.test.ts` covering: happy path, unauthorized thread, missing job, no-op when value matches current, idempotency.

Out:
- The UI hookup — plan 07.
- Reading the field at the start of `generateResponse` — plan 06.

## Design

The mutation:
1. Validates auth via the same helper used by `sendMessage` — `authorizeThreadAccess(ctx, threadId)` (`convex/chat/messages.ts:212`).
2. Looks up the `extractionJobs` row by `chatThreadId` index (existing index `by_chatThread`).
3. If the field already equals the requested value, returns `{ outcome: "noop" }` and does not patch.
4. Otherwise, patches `extractionJobs[id]` with `{ webSearchEnabled: enabled }`.
5. Returns `{ outcome: "updated" | "noop" }`.

No optimistic update on the client — the toggle's visual state is bound directly to the Convex query result (`useQuery` of the chat job). React's render derives from server truth; CLAUDE.md ban on `useEffect` for state sync prevents any local-mirror approach. (See plan 07 for the UI specifics.)

### Naming

Per `00-README.md` §6 reuse notes and existing conventions in `convex/chat/messages.ts`:
- Public mutation name: `setChatWebSearchEnabled`.
- Returns: `v.object({ outcome: v.union(v.literal("updated"), v.literal("noop")) })`.

### Authorization

Reuse `authorizeThreadAccess` (`convex/chat/messages.ts:212` and similar). It throws if the calling user does not own the thread. Do not invent a new authorization shape.

## TDD sequence

Phase A — none (no pure logic in this plan; the mutation is a thin DB-touching handler).

Phase B — test-after, one commit per logical assertion:

U1 — Add the mutation skeleton with the validators and the auth call. Commit `feat(chat): [plan-03] add setChatWebSearchEnabled mutation skeleton`.

U2 — Implement the lookup-and-patch logic with the no-op short-circuit. Commit `feat(chat): [plan-03] implement webSearchEnabled patch logic`.

U3 — Add tests. Each test or pair of tests is one commit (per CLAUDE.md commit discipline):
- `test(chat): [plan-03] setChatWebSearchEnabled happy path`
- `test(chat): [plan-03] setChatWebSearchEnabled rejects non-owner`
- `test(chat): [plan-03] setChatWebSearchEnabled returns noop when same value`
- `test(chat): [plan-03] setChatWebSearchEnabled rejects missing thread`

## Files touched

- `convex/chat/messages.ts` (~ 30 LOC)
- `convex/chat/messages.test.ts` (~ 80 LOC)

## Migration stance

None — reads/writes a field already validated by plan 01.

## Test plan

- `convex/chat/messages.test.ts` extensions:
  - **Happy path**: insert a chat job for user A, call `setChatWebSearchEnabled({ threadId, enabled: true })` with A's identity, assert the row's `webSearchEnabled === true` and `outcome === "updated"`.
  - **Idempotent / no-op**: call again with the same value, assert `outcome === "noop"` and the row was not re-patched (e.g., assert no extra `_creationTime` jitter — or assert the call returned without an unnecessary db.patch).
  - **Authorization**: call from user B, expect throw (the same error class the rest of the chat mutations use — verify via the existing test pattern).
  - **Missing thread**: call with an unknown threadId, expect throw.
  - **Disable**: turn on then off, assert `false` after second call.
- No browser/UI test in this plan.

## Acceptance criteria

- [ ] `setChatWebSearchEnabled` is exported as a `mutation` (public, not `internalMutation`) from `convex/chat/messages.ts`.
- [ ] Args validator is `{ threadId: v.string(), enabled: v.boolean() }`.
- [ ] Returns the documented union type.
- [ ] All five test cases pass.
- [ ] Auth path matches `sendMessage`'s — uses the same helper, throws the same error class.
- [ ] `tsc --noEmit` clean.
- [ ] Codegen runs clean and the new mutation appears in `_generated/api.ts`.

## Known pitfalls

- **Do not** create a Convex `internalMutation` — the UI calls this directly, so it must be public.
- **Do not** create a separate read query for the field. Existing chat thread queries (e.g., the queries used by `useUIMessages` and the chat header) will surface the field via the job row once codegen picks up the schema change. If the UI needs a focused read, plan 07 will reuse an existing query rather than adding one here.
- **Do not** schedule any side effects (no toast, no analytics event) inside the mutation — UI fires those on the call site if needed.
- **Idempotency matters**: returning `noop` when value equals current avoids spurious cache invalidations on the Convex client (Convex queries re-run when their dependent rows change; not patching a row whose value did not change keeps the dependent queries from refetching).
- **Concurrency**: a user could spam the toggle. The mutation is single-row; Convex serializes mutations on the same document. No explicit lock needed. Do not add one.
