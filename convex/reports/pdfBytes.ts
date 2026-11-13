// A report's PDF as the actions that work on it hold it (./reading.ts, ./checks.ts).
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

/**
 * A stored PDF's bytes, read on their own. The Blob they arrive in is let go as soon as they are out of it, so a PDF
 * near the upload limit is held once while it is worked on, not twice. Throws when the file is gone.
 */
export async function storedBytes(ctx: Pick<ActionCtx, "storage">, file: Id<"_storage">) {
  const blob = await ctx.storage.get(file);
  if (!blob) throw new Error("The report's PDF is gone.");
  return new Uint8Array(await blob.arrayBuffer());
}
