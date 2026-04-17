/**
 * Bounded-concurrency worker for bulk file uploads. Independent of React
 * so we can unit-test it cheaply; the UI wires this to a reducer state
 * and a status-per-file map.
 */
export type UploadAttempt<T, R> = (item: T) => Promise<R>;

export async function runWithConcurrency<T, R>(
  items: T[],
  attempt: UploadAttempt<T, R>,
  concurrency: number,
): Promise<Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }>> {
  const results: Array<
    | { item: T; ok: true; value: R }
    | { item: T; ok: false; error: unknown }
  > = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      try {
        const value = await attempt(item);
        results[index] = { item, ok: true, value };
      } catch (error) {
        results[index] = { item, ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export type PdfValidationError =
  | "wrong-mime"
  | "too-large";

export function validatePdfFile(
  file: Pick<File, "type" | "size">,
  maxBytes: number,
): PdfValidationError | null {
  if (file.type !== "application/pdf") return "wrong-mime";
  if (file.size > maxBytes) return "too-large";
  return null;
}
