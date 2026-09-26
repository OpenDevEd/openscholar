import { auth } from "@clerk/nextjs/server";
import { preloadQuery } from "convex/nextjs";
import { PreloadedAuthorProfile } from "@/components/authors/author-profile";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
export default async function Page({params}: {params: Promise<{profileId: string}>}) {
  const {profileId} = await params;
  // The profile renders with the page. The viewer's token keeps their role,
  // and so the edit controls, right from the first frame.
  const token = (await (await auth()).getToken({template: "convex"})) ?? undefined;
  const [preloadedRecord, preloadedReferences] = await Promise.all([
    preloadQuery(api.authors.profiles.get, {profileId}, {token}),
    preloadQuery(api.authors.publications.list, {profileId}, {token}),
  ]);
  return <PreloadedAuthorProfile profileId={profileId as Id<"authorProfiles">} preloadedRecord={preloadedRecord} preloadedReferences={preloadedReferences} />;
}
