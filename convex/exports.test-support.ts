import type { TestConvex } from "convex-test";
import { api } from "./_generated/api";
import { digestOpaqueToken } from "./lib/opaqueTokenDigest";
import type schema from "./schema";
import type { ExportSource } from "./exportValidators";
import type { LibraryView } from "./library/validators";

type Test = TestConvex<typeof schema>;
type Signed = ReturnType<Test["withIdentity"]>;

/**
 * Starts an export of `source` as the signed-in person and downloads every part through
 * `/export`, as the browser does: the next part once the last is done.
 */
export async function exportParts(t: Test, as: Signed, source: ExportSource, format: "csv" | "json" = "json") {
  const token = `test-${crypto.randomUUID()}`;
  const digest = await digestOpaqueToken(token);
  await as.mutation(api.exports.start, { digest, format, source });
  const parts: Array<{ response: Response; text: string }> = [];
  for (let part: number | null = 1; part !== null; part = (await as.query(api.exports.progress, { digest }))?.part ?? null) {
    const response = await t.fetch(`/export?token=${token}&part=${part}`);
    // Decoded as the file's bytes are, keeping a CSV's byte order mark, which `text()` drops.
    parts.push({ response, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer()) });
    if (response.status !== 200) break;
  }
  return { token, parts, response: parts[0].response, text: parts[0].text };
}

export const exportLibrary = (t: Test, as: Signed, view: LibraryView, format: "csv" | "json" = "json") => exportParts(t, as, { kind: "library", view }, format);

/** The titles a JSON export holds across its parts, in order. */
export async function exportedTitles(t: Test, as: Signed, view: LibraryView) {
  const { parts } = await exportLibrary(t, as, view);
  return parts.flatMap(({ text }) => (JSON.parse(text) as { items: Array<{ title: string }> }).items.map((item) => item.title));
}
