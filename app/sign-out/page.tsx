import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { api } from "@/convex/_generated/api";
import { SignOut } from "./sign-out";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workspaces");
  return { title: t("signOut"), robots: { index: false } };
}

/** An address's origin when a community answers there; null for any other address, or one that can't be checked. */
async function communityOrigin(address: string | string[] | null | undefined) {
  if (typeof address !== "string" || !URL.canParse(address)) return null;
  const { protocol, origin } = new URL(address);
  if (protocol !== "https:") return null;
  try {
    return (await fetchQuery(api.evidenceLibraries.sources.isCommunity, { origin })) ? origin : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "sign-out-return-check-failed", origin, error: String(error).slice(0, 300) }));
    return null;
  }
}

/**
 * Where a community sends its reader when they sign out there, so they are signed out of Openscholar too, and come
 * straight back to the page they were on (`redirect_url`).
 *
 * It signs out only when the browser says the request came from that same community (its Referer, which a page
 * elsewhere can't set): a link on another site can't sign anyone out. And it goes back only to an address a community
 * answers at, never wherever a link says. Anything else gets the home page, signed in as before.
 */
export default async function SignOutPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string | string[] }> }) {
  const [{ redirect_url: asked }, requestHeaders] = await Promise.all([searchParams, headers()]);
  const [back, from] = await Promise.all([communityOrigin(asked), communityOrigin(requestHeaders.get("referer"))]);
  if (!back) redirect("/");
  // A browser that sends no Referer still gets back to its community, signed out there only, as before this page existed.
  if (from !== back) redirect(asked as string);
  return <SignOut to={asked as string} />;
}
