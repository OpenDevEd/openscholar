import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { describeQueryError, type QueryErrorDetail } from "@/lib/search/search-error";
import { openAlexUrl } from "./request-url";
import { withinTimeLimit } from "./time-limit";
import { worksPageSchema } from "./work-schema";

type OqlResponse = Works & {
  validation?: { errors?: { type?: string; message?: string; position?: number | null }[] };
  message?: string;
  error?: string;
};

export type OqlWorksResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string; detail?: QueryErrorDetail };

const FAILED = { ok: false, status: null, message: "Search request failed" } as const;
const TIMED_OUT = { ok: false, status: null, message: "Search request timed out" } as const;

/**
 * Runs an OQL query. SERVER SIDE ONLY: it reads the OpenAlex API key.
 * POST, because OQL queries outgrow OpenAlex's URL limit.
 * Works come back shaped like the SDK's, with the abstract as text, each checked as the
 * search checks its own, and the query gives up after the same time limit.
 */
export async function fetchOqlWorks(
  oql: string,
  view: { perPage: number; sort?: string; cursor?: string },
): Promise<OqlWorksResult> {
  const url = openAlexUrl("", { "per-page": String(view.perPage), cursor: view.cursor, sort: view.sort });
  return withinTimeLimit((signal) => askOql(url, oql, signal));
}

/** The OQL query's works at `url`, or why there are none, read before `signal` aborts. */
async function askOql(url: URL, oql: string, signal: AbortSignal): Promise<OqlWorksResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oql }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return TIMED_OUT;
    console.error("OpenAlex OQL request failed:", error);
    return FAILED;
  }
  const body = (await response.json().catch(() => null)) as OqlResponse | null;
  if (body === null && signal.aborted) return TIMED_OUT;

  if (!response.ok || !body) {
    const errors = body?.validation?.errors ?? [];
    console.error("OpenAlex OQL error:", response.status, JSON.stringify(body)?.slice(0, 1000));
    const message = errors[0]?.message ?? body?.message ?? body?.error ?? `Search request failed (${response.status})`;
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

  const page = worksPageSchema.safeParse(body);
  if (!page.success) {
    console.error("An OQL answer is not a page of works:", page.error.issues.slice(0, 3));
    return FAILED;
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
