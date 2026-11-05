import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { cookies, headers } from "next/headers";
import { AuthorList } from "@/components/authors/author-list";
import { AUTHOR_PAGE_SIZE } from "@/components/authors/types";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";
import { readExampleAuthors } from "@/lib/authors/example-authors";
import { LOOK_COOKIE, lookKey, readCache, WORKSPACE_HEADER } from "@/lib/workspaces/look-cache";
export default async function Page() {
  const [{userId}, requestHeaders, requestCookies, examples] = await Promise.all([auth(), headers(), cookies(), readExampleAuthors()]);
  // "Create author" from the first frame, as the rail last saw this workspace's plan, until the plan is read.
  const look = readCache(requestCookies.get(LOOK_COOKIE)?.value, userId).looks[lookKey(requestHeaders.get(WORKSPACE_HEADER) || null)];
  const createsBefore = look?.author === true;
  // Hand-made profiles are for a workspace whose plan makes them, so only one sends them with the page.
  const firstPage = createsBefore ? await fetchQuery(api.authors.profiles.list, {search: "", paginationOpts: {numItems: AUTHOR_PAGE_SIZE, cursor: null}}) : {page: [], isDone: true, continueCursor: ""};
  return <PageWrapper><AuthorList createsBefore={createsBefore} firstPage={firstPage} examples={examples} /></PageWrapper>;
}
