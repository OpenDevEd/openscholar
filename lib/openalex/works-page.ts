import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Work, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { worksUrl } from "./works-url";

/** A works page, or why there is none, with the API's own message when it gave one. */
export type WorksPageResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string };

type WorksResponse = Works & { message?: string; error?: string };

/**
 * The first page of a works search, with each abstract as text, as the SDK answered it.
 * Asked with fetch rather than the SDK, which keeps one key for every host it is given and
 * drops the body of a failure, the message the search page shows. Server side only: it
 * reads the key.
 */
export async function fetchWorksPage(parameters: SearchParameters & { perPage: number }): Promise<WorksPageResult> {
  let response: Response;
  try {
    response = await fetch(worksUrl(parameters, { per_page: String(parameters.perPage), cursor: "*" }));
  } catch (error) {
    console.error("Works request failed:", error);
    return { ok: false, status: null, message: "Search request failed" };
  }
  const body = (await response.json().catch(() => null)) as WorksResponse | null;
  if (!response.ok || !body) {
    const message = body?.message || body?.error || `Search request failed (${response.status})`;
    return { ok: false, status: response.status, message };
  }
  return {
    ok: true,
    data: {
      meta: body.meta,
      results: body.results.map(({ abstract_inverted_index, ...work }: Work) => ({
        ...work,
        ...(abstract_inverted_index ? { abstract: convertAbstractArrayToString(abstract_inverted_index) } : {}),
      })),
    } as Works,
  };
}
