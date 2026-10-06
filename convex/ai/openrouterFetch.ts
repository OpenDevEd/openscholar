/**
 * Abort-safe capture of OpenRouter's `X-Generation-Id` response header.
 *
 * The header ships on the initial HTTP response frame (before any SSE
 * body is parsed and before any consumer-side AbortSignal can race the
 * read), so wrapping `createOpenRouter({ fetch })` with this helper lets
 * the chat runtime reconcile billing for normal finishes AND user stops
 * against OpenRouter's `/api/v1/generation` endpoint.
 *
 * Why not `providerMetadata.openrouter.responseId`? It is parsed from
 * SSE body events (`node_modules/@openrouter/ai-sdk-provider/dist/index.mjs`
 * around line 700) — `undefined` when the stream aborts before those
 * events arrive. Why not `onFinish`? It does not fire on abort
 * (`node_modules/ai/src/generate-text/stream-text.ts` around lines
 * 1203-1217). See plans/chat-exact-stop-billing/01-authoritative-usage-source.md
 * for the locked design and rejected alternatives.
 */

export type GenerationIdSink = (generationId: string) => void;

export function withGenerationIdCapture(
  sink: GenerationIdSink,
  innerFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await innerFetch(input, init);
    const id = response.headers.get("x-generation-id");
    if (id && id.length > 0) sink(id);
    return response;
  };
}
