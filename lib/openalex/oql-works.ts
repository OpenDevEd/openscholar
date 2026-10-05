import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { Work, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { describeQueryError, type QueryErrorDetail } from "@/lib/search/search-error";
import { openAlexFetch, openAlexReason } from "./fetch";
import { openAlexUrl } from "./request-url";

type OqlResponse = Works & {
  validation?: { errors?: { type?: string; message?: string; position?: number | null }[] };
  message?: string;
  error?: string;
};

export type OqlWorksResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string; detail?: QueryErrorDetail };

/**
 * Runs an OQL query. SERVER SIDE ONLY: it reads the OpenAlex API key.
 * POST, because OQL queries outgrow OpenAlex's URL limit.
 * Works come back shaped like the SDK's, with the abstract as text.
 */
export async function fetchOqlWorks(
  oql: string,
  view: { perPage: number; sort?: string; cursor?: string },
): Promise<OqlWorksResult> {
  const url = openAlexUrl("", { "per-page": String(view.perPage), cursor: view.cursor, sort: view.sort });

  let response: Response;
  try {
    response = await openAlexFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oql }),
    });
  } catch (error) {
    console.error("OpenAlex OQL request failed:", error);
    return { ok: false, status: null, message: "Search request failed" };
  }
  const body = (await response.json().catch(() => null)) as OqlResponse | null;

  if (!response.ok || !body) {
    const errors = body?.validation?.errors ?? [];
    console.error("OpenAlex OQL error:", response.status, JSON.stringify(body)?.slice(0, 1000));
    const message = openAlexReason(body) ?? body?.error ?? `Search request failed (${response.status})`;
    return {
      ok: false,
      status: response.status,
      message,
      ...(response.status === 400 ? { detail: describeQueryError(oql, errors[0] ?? { message }) } : {}),
    };
  }

  // `group by` answers with groups, which a list of works cannot show.
  if (!Array.isArray(body.results)) {
    const message = "The results page lists works, so group by is not supported.";
    return { ok: false, status: 400, message, detail: { problem: message } };
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
