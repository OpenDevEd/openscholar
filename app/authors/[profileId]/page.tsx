import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { preloadedQueryResult, preloadQuery } from "convex/nextjs";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { readAuthorCard, type AuthorCard } from "@/app/actions/author-card";
import { AutomaticAuthor } from "@/components/authors/automatic-author";
import { PreloadedAuthorProfile } from "@/components/authors/author-profile";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { linksOf, MOCK_LINKS_COOKIE, parseLinks } from "@/lib/authors/mock-links";
import { isAuthorId } from "@/lib/openalex/author-filter";

const cardOf = async (id: string): Promise<AuthorCard | null> => {
  const card = await readAuthorCard(id).catch((error) => {
    console.error("[authors] couldn't read an author", id, error);
    return null;
  });
  return card && "id" in card ? card : null;
};

/** An automatic page is only as good as its record, so it stays out of search engines. A hand-made profile stays in them. */
export async function generateMetadata({params}: {params: Promise<{profileId: string}>}): Promise<Metadata> {
  const {profileId} = await params;
  return isAuthorId(profileId) ? {robots: {index: false, follow: true}} : {};
}

export default async function Page({params}: {params: Promise<{profileId: string}>}) {
  const {profileId} = await params;
  // An author's ID opens their profile when one links it, the page of the OpenAlex author it's paired with when there is one, or a page of its own.
  if (isAuthorId(profileId)) {
    const card = await cardOf(profileId);
    if (!card) notFound();
    if (card.profileId) redirect(`/authors/${card.profileId}`);
    if (card.paired && card.paired !== profileId) redirect(`/authors/${card.paired}`);
    return <AutomaticAuthor card={card} />;
  }
  // The profile renders with the page. The viewer's token keeps their role,
  // and so the edit controls, right from the first frame.
  const {getToken} = await auth();
  const token = (await getToken({template: "convex"})) ?? undefined;
  const [preloadedRecord, preloadedReferences] = await Promise.all([
    preloadQuery(api.authors.profiles.get, {profileId}, {token}),
    preloadQuery(api.authors.publications.list, {profileId}, {token}),
  ]);
  const linked = preloadedQueryResult(preloadedRecord)?.openalex;
  const links = linksOf(parseLinks((await cookies()).get(MOCK_LINKS_COOKIE)?.value), profileId);
  return <PreloadedAuthorProfile profileId={profileId as Id<"authorProfiles">} preloadedRecord={preloadedRecord} preloadedReferences={preloadedReferences} card={linked ? await cardOf(linked) : null} links={links} />;
}
