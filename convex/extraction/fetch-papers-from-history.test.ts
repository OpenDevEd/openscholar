import { afterEach, expect, it, vi } from "vitest";
import { runFetchPapersFromHistory } from "./actions";

afterEach(() => vi.unstubAllGlobals());

it("refuses a search saved before its exact request was kept, without asking OpenAlex", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(
    runFetchPapersFromHistory({ query: "heart disease", selectedCountryFocus: ["KE"], limit: 2 }),
  ).rejects.toThrow(/Add it again/);
  expect(request).not.toHaveBeenCalled();
});
