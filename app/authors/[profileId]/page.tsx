import { AuthorProfileView } from "@/components/authors/author-profile";
import type { Id } from "@/convex/_generated/dataModel";
export default async function Page({params}: {params: Promise<{profileId: string}>}) {
  const {profileId} = await params;
  return <AuthorProfileView profileId={profileId as Id<"authorProfiles">} />;
}
