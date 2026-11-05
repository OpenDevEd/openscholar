import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { fetchQuery, preloadedQueryResult, preloadQuery } from "convex/nextjs";
import { notFound, redirect } from "next/navigation";
import { readAuthorCard, type AuthorCard } from "@/app/actions/author-card";
import { readProfileAuthorWorks, type AuthorWorksPage } from "@/app/actions/authors";
import { AutomaticAuthor } from "@/components/authors/automatic-author";
import { PreloadedAuthorProfile } from "@/components/authors/author-profile";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isAuthorId } from "@/lib/openalex/author-filter";
import { workspaceHref } from "@/lib/workspaces/paths";

/** An author's record. Null for one the source doesn't have. A read that failed, or a visitor at their limit, goes to the error page, which says to try again. */
const cardOf = async (id: string): Promise<AuthorCard | null> => {
  const card = await readAuthorCard(id);
  if (card && !("id" in card)) throw new Error("Too many requests");
  return card;
};

/** A page's first papers, with the page, so their count is there from the first frame. Its own read tries again if this one can't. */
const firstWorksOf = async (ids: string): Promise<AuthorWorksPage | null> => {
  const works = await readProfileAuthorWorks(ids, 1).catch((error) => {
    console.error("[authors] couldn't read an author's papers", ids, error);
    return null;
  });
  return works && "results" in works ? works : null;
};

/** An automatic page is only as good as its record, so it stays out of search engines. A hand-made profile stays in them. */
export async function generateMetadata({params}: {params: Promise<{profileId: string}>}): Promise<Metadata> {
  const {profileId} = await params;
  return isAuthorId(profileId) ? {robots: {index: false, follow: true}} : {};
}

export default async function Page({params}: {params: Promise<{profileId: string; slug?: string}>}) {
  const {profileId, slug} = await params;
  // An author's ID opens their profile when one links it, the page of the OpenAlex author it's paired with when there is one, or a page of its own.
  if (isAuthorId(profileId)) {
    // Asked first: a linked ID opens its profile whether or not the source can read the record just now.
    const linked = await fetchQuery(api.authors.links.profileFor, {ids: [profileId]});
    if (linked) redirect(workspaceHref(slug, `/authors/${linked}`));
    const card = await cardOf(profileId);
    if (!card) notFound();
    if (card.profileId) redirect(workspaceHref(slug, `/authors/${card.profileId}`));
    if (card.paired && card.paired !== profileId) redirect(workspaceHref(slug, `/authors/${card.paired}`));
    return <AutomaticAuthor card={card} firstWorks={await firstWorksOf(profileId)} />;
  }
  // The profile renders with the page. The viewer's token keeps their role,
  // and so the edit controls, right from the first frame.
  const {getToken} = await auth();
  const token = (await getToken({template: "convex"})) ?? undefined;
  const [preloadedRecord, preloadedReferences, preloadedRecords] = await Promise.all([
    preloadQuery(api.authors.profiles.get, {profileId}, {token}),
    preloadQuery(api.authors.publications.list, {profileId}, {token}),
    preloadQuery(api.authors.links.records, {profileId}, {token}),
  ]);
  const main = preloadedQueryResult(preloadedRecord)?.openalex;
  return <PreloadedAuthorProfile profileId={profileId as Id<"authorProfiles">} preloadedRecord={preloadedRecord} preloadedReferences={preloadedReferences} preloadedRecords={preloadedRecords} card={main ? await cardOf(main).catch((error) => {
    // The profile stands without its record's details.
    console.error("[authors] couldn't read a profile's record", main, error);
    return null;
  }) : null} />;
}
