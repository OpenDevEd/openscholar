import { z } from "zod";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { worksUrl } from "./works-url";

/** A works page, or why there is none, with the API's own message when it gave one. */
export type WorksPageResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string };

/** What a page must hold to be read: its count, and works with an id and any abstract's index. */
const pageSchema = z.object({
  meta: z.looseObject({ count: z.number().int().nonnegative() }),
  results: z.array(z.looseObject({
    id: z.string(),
    abstract_inverted_index: z.record(z.string(), z.array(z.number().int().nonnegative())).nullable().optional(),
  })),
});

/** A refusal's own reason: its `message`, else its `error`, else its status. */
function reasonOf(body: unknown, status: number) {
  const reason = typeof body === "object" && body !== null ? (body as { message?: unknown; error?: unknown }) : {};
  if (typeof reason.message === "string" && reason.message) return reason.message;
  if (typeof reason.error === "string" && reason.error) return reason.error;
  return `Search request failed (${status})`;
}

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
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, message: reasonOf(body, response.status) };
  const page = pageSchema.safeParse(body);
  if (!page.success) {
    console.error("A works answer is not a page of works:", page.error.issues.slice(0, 3));
    return { ok: false, status: null, message: "Search request failed" };
  }
  return {
    ok: true,
    data: {
      meta: page.data.meta,
      results: page.data.results.map(({ abstract_inverted_index, ...work }) => ({
        ...work,
        ...(abstract_inverted_index ? { abstract: convertAbstractArrayToString(abstract_inverted_index) } : {}),
      })),
    } as unknown as Works,
  };
}
