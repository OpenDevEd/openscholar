import { afterEach, describe, expect, it, vi } from "vitest";
import { previewOpenAlexSource } from "@/app/actions/openalex-source-preview";

describe("previewOpenAlexSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("previews the exact search and filter without fetching a count", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "platform-key");
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: "https://openalex.org/W1",
                title: "Teaching with evidence",
                publication_year: 2025,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      previewOpenAlexSource({
        search: "  teacher education  ",
        filter: "  type:article  ",
      }),
    ).resolves.toEqual({
      ok: true,
      works: [
        {
          id: "https://openalex.org/W1",
          title: "Teaching with evidence",
          publicationYear: 2025,
        },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: "teacher education",
      filter: "type:article",
      "per-page": "10",
      select: "id,title,publication_year",
      api_key: "platform-key",
    });
  });

  it("rejects an empty query before calling OpenAlex", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(previewOpenAlexSource({ search: "  " })).resolves.toEqual({
      ok: false,
      message: "Enter a search or filter",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
