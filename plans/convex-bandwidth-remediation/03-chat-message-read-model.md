# Plan 03 — Chat Message Read Model

## Goal

Reduce active-chat bandwidth by collapsing `listThreadMessages` from a duplicated multi-read shape to one authoritative message-doc read plus stream synchronization, while preserving aborted/error rendering and streaming behavior.

## Scope

In scope:

- slim `convex/chat/messages.ts:listThreadMessages`,
- keep `syncStreams` for live stream deltas,
- eliminate duplicate thread-corpus reads where one message-doc read is enough,
- preserve failed/aborted error-envelope behavior consumed by the client.

Out of scope:

- source/inclusion query work from plan 02,
- UI redesign of the message list,
- replacing `@convex-dev/agent`,
- new packages.

## Design

1. **Use one authoritative message-doc page read.**
   Replace the current “UI messages + raw messages” double-read with one message-doc read, then convert/project once for the UI response shape.

2. **Keep stream sync separate.**
   `syncStreams` remains the live delta path. The optimization is about duplicated base-message reads, not about removing streaming.

3. **Prefer installed agent helpers where available.**
   If the installed `@convex-dev/agent` version exposes a stable message-doc → UI-message helper, use it. If not, extract the minimal conversion locally from the current behavior and keep it covered by tests.

4. **Retain explicit aborted/error semantics.**
   The client must still receive the same `aborted` and `error` behavior it gets today.

5. **Add bounded pagination/size options if the installed helper supports them.**
   If the current package version supports `maximumRowsRead`/`maximumBytesRead` style caps for paginated reads, adopt them in the same slice.

## TDD sequence

1. Add red query tests for `listThreadMessages` covering:
   - normal message pages,
   - failed assistant message envelopes,
   - aborted assistant messages,
   - streams present alongside the converted page.
2. Add a red test proving only one base message read path remains in the implementation.
3. Green the query rewrite.
4. Add or update client behavior tests to prove the rendered message list still handles aborted/failed messages identically.
5. Refactor only after parity is green.

## Files touched

- `convex/chat/messages.ts`
- `convex/chat/messages.test.ts` and/or related chat query tests
- message-list/client tests as needed
- optional small helper under `convex/chat/`

## Migration stance

None.

- No schema changes.
- No compatibility branch that keeps the old duplicated read path alive.

## Test plan

- Convex query tests for message-page parity.
- Component tests for aborted/failed rendering and stream continuity.
- Manual smoke:
  - open an active chat thread,
  - stream a response,
  - abort a response,
  - trigger a failure path,
  - verify the UI behavior matches current semantics.

## Acceptance criteria

- `listThreadMessages` no longer performs duplicated base-message reads for the same thread page.
- Aborted and failed messages still render correctly.
- Streaming continues to work with `syncStreams`.
- No new dependency is added.

## Known pitfalls

- Do not regress the agent streaming contract while slimming the base read path.
- Verify the installed `@convex-dev/agent` helper API before coding; avoid assuming a helper exists if the package version differs.
- Preserve auth/ownership checks exactly.

