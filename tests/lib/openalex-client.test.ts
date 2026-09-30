import OpenAlexClient from "@sickrin/openalex-sdk";
import { buildUrl } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters } from "@sickrin/openalex-sdk/dist/src/types/work";
import { afterEach, describe, expect, it, vi } from "vitest";
import client from "@/lib/openalex";

describe("OpenAlex SDK client", () => {
  afterEach(() => vi.restoreAllMocks());

  // The SDK pastes search text into its URLs as it is; "#" would end the query and drop the key.
  it("hands the SDK search text and filter values that survive its URL builder", async () => {
    const works = vi.spyOn(OpenAlexClient.prototype, "works").mockResolvedValue({} as never);
    const authors = vi.spyOn(OpenAlexClient.prototype, "authors").mockResolvedValue({} as never);
    await client.works({ search: "C# & R+D", filter: { title_and_abstract: { search: "C# & R+D" } } as SearchParameters["filter"], perPage: 1 });
    await client.authors({ search: "C# & R+D", perPage: 1 });
    const sent = works.mock.calls[0]![0]!;
    const url = new URL(buildUrl("https://api.openalex.org", "works", sent.search, undefined, sent.filter) + "&api_key=platform-key");
    expect(url.searchParams.get("search")).toBe("C# & R+D");
    expect(url.searchParams.get("filter")).toBe("title_and_abstract.search:C# & R+D");
    expect(url.searchParams.get("api_key")).toBe("platform-key");
    expect(authors.mock.calls[0]![0]!.search).toBe(encodeURIComponent("C# & R+D"));
  });
});
