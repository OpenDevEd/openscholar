import { afterEach, expect, it, vi } from "vitest";
vi.mock("@clerk/nextjs/server", () => ({auth: async () => ({userId: null})}));
import { searchOpenAlexTopicOptions } from "@/app/actions/openalex-topic-options";
afterEach(() => vi.unstubAllGlobals());
it("requires authentication before looking up source topics", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(searchOpenAlexTopicOptions("topic", "education")).rejects.toThrow("Sign in");
  expect(request).not.toHaveBeenCalled();
});
