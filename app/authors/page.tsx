import { auth } from "@clerk/nextjs/server";
import { cookies, headers } from "next/headers";
import { AuthorList } from "@/components/authors/author-list";
import { PageWrapper } from "@/components/PageWrapper";
import { LOOK_COOKIE, lookKey, readCache, WORKSPACE_HEADER } from "@/lib/workspaces/look-cache";
export default async function Page() {
  const [{userId}, requestHeaders, requestCookies] = await Promise.all([auth(), headers(), cookies()]);
  // "Create author" from the first frame, as the rail last saw this workspace's plan, until the plan is read.
  const look = readCache(requestCookies.get(LOOK_COOKIE)?.value, userId).looks[lookKey(requestHeaders.get(WORKSPACE_HEADER) || null)];
  return <PageWrapper><AuthorList createsBefore={look?.author === true} /></PageWrapper>;
}
