import { afterEach, expect, it, vi } from "vitest";
import { repairCitations } from "./citations";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const publication = (key: string, creators: string[], date: string, title: string) => ({key, creators, date, title, abstract: null, publicationType: "Report", doi: null});
const publications = [
  publication("ABCD2345", ["Caitlin Mills"], "2026", "Attention in classrooms"),
  publication("ZXCV1234", ["Caitlin Mills"], "2026", "Mind wandering while reading"),
  publication("QWER7890", ["Joy Okafor"], "2025", "School meals and attendance"),
];

it("fixes a key typo by the cited author without a model and unlinks what it cannot place", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No model call expected"));
  const {markdown, repairs} = await repairCitations(
    "Attention drops [Mills, 2026](/lib/ABCD2354). Meals help [Okafor, 2025](/lib/NOPE0000). Read [Okafor, 2025](https://example.org). Kept [Mills, 2026](/lib/ZXCV1234).",
    publications,
  );
  expect(markdown).toBe("Attention drops [Mills, 2026](/lib/ABCD2345). Meals help Okafor, 2025. Read Okafor, 2025. Kept [Mills, 2026](/lib/ZXCV1234).");
  expect(repairs.map(repair => repair.method).sort()).toEqual(["typo", "unlinked", "unlinked"]);
  expect(provider).not.toHaveBeenCalled();
});

it.each([
  {verified: 0.95, markdown: "Attention drops [Mills, 2026](/lib/ABCD2345)."},
  {verified: 0.88, markdown: "Attention drops Mills, 2026."},
])("links Jev's pick only when its check scores at least 0.9 ($verified)", async ({verified, markdown}) => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const requests: Array<{url: string; body: {model: string; questions: Record<string, unknown>}}> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({url: String(url), body});
    return Response.json({answers: "c" in body.questions ? {c: {choice: "ABCD2345"}} : {v: {noul: verified}}});
  });
  const result = await repairCitations("Attention drops [Mills, 2026](/lib/QQQQQQQQ).", publications);
  expect(result.markdown).toBe(markdown);
  expect(requests.map(request => [request.url, request.body.model])).toEqual([0, 1].map(() => ["https://openrouter.ai/api/alpha/decisions", "~typesafe/jev-latest"]));
  // Both papers by the cited author and year are offered.
  expect(Object.keys((requests[0]!.body.questions.c as {criteria: object}).criteria)).toEqual(expect.arrayContaining(["ABCD2345", "ZXCV1234", "none"]));
});
