import type { RunResult } from "@convex-dev/workpool";

/**
 * Dispatcher for `pdfProcessingPool.defineOnComplete` handlers.
 * Removes the repeated `switch (result.kind)` scaffolding so each
 * onComplete site only declares the three narrow branch handlers.
 */
export async function handleWorkpoolResult<TCtx>(
  ctx: TCtx,
  result: RunResult,
  handlers: {
    onSuccess: (ctx: TCtx, returnValue: unknown) => Promise<void>;
    onFailed: (ctx: TCtx, error: string) => Promise<void>;
    onCanceled: (ctx: TCtx) => Promise<void>;
  },
): Promise<void> {
  switch (result.kind) {
    case "success":
      await handlers.onSuccess(ctx, result.returnValue);
      return;
    case "failed":
      await handlers.onFailed(ctx, result.error);
      return;
    case "canceled":
      await handlers.onCanceled(ctx);
      return;
  }
}
