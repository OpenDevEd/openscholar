import { auth } from "@clerk/nextjs/server";
import { cookies, headers } from "next/headers";
import { preloadQuery } from "convex/nextjs";
import { PreloadedAuthorProfile } from "@/components/authors/author-profile";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LOOK_COOKIE, lookKey, readCache, WORKSPACE_HEADER } from "@/lib/workspaces/look-cache";
export default async function Page({params}: {params: Promise<{profileId: string}>}) {
  const {profileId} = await params;
  // The profile renders with the page. The viewer's token keeps their role,
  // and so the edit controls, right from the first frame.
  const {userId, getToken} = await auth();
  const token = (await getToken({template: "convex"})) ?? undefined;
  const [preloadedRecord, preloadedReferences, requestHeaders, requestCookies] = await Promise.all([
    preloadQuery(api.authors.profiles.get, {profileId}, {token}),
    preloadQuery(api.authors.publications.list, {profileId}, {token}),
    headers(),
    cookies(),
  ]);
  // The back link to Authors, from the first frame: as the rail last drew this workspace, until its features are read.
  const look = readCache(requestCookies.get(LOOK_COOKIE)?.value, userId).looks[lookKey(requestHeaders.get(WORKSPACE_HEADER) || null)];
  return <PreloadedAuthorProfile profileId={profileId as Id<"authorProfiles">} preloadedRecord={preloadedRecord} preloadedReferences={preloadedReferences} browsedBefore={look?.publish === true} />;
}
