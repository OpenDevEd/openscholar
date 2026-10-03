import type { TestConvex } from "convex-test";
import { api } from "../_generated/api";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import type schema from "../schema";
import type { LibraryView } from "./validators";

type Test = TestConvex<typeof schema>;
type Signed = ReturnType<Test["withIdentity"]>;

/**
 * Starts an export of `view` as the signed-in person and downloads every part through
 * `/library/export`, as the browser does: the next part once the last is done.
 */
export async function exportLibrary(t: Test, as: Signed, view: LibraryView, format: "csv" | "json" = "json") {
  const token = `test-${crypto.randomUUID()}`;
  const digest = await digestOpaqueToken(token);
  await as.mutation(api.library.exports.start, { digest, format, view });
  const parts: Array<{ response: Response; text: string }> = [];
  for (let part: number | null = 1; part !== null; part = (await as.query(api.library.exports.progress, { digest }))?.part ?? null) {
    const response = await t.fetch(`/library/export?token=${token}&part=${part}`);
    // Decoded as the file's bytes are, keeping a CSV's byte order mark, which `text()` drops.
    parts.push({ response, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer()) });
    if (response.status !== 200) break;
  }
  return { token, parts, response: parts[0].response, text: parts[0].text };
}

/** The titles a JSON export holds across its parts, in order. */
export async function exportedTitles(t: Test, as: Signed, view: LibraryView) {
  const { parts } = await exportLibrary(t, as, view);
  return parts.flatMap(({ text }) => (JSON.parse(text) as { items: Array<{ title: string }> }).items.map((item) => item.title));
}
