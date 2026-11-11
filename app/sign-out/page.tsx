import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { api } from "@/convex/_generated/api";
import { SignOut } from "./sign-out";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workspaces");
  return { title: t("signOut"), robots: { index: false } };
}

/**
 * Where signing out goes afterwards: the page that asked (`redirect_url`), only when a community answers at its
 * address. A community sends its reader here when they sign out there, so they are signed out of both. Any other
 * address, or one that can't be checked, gets the home page: this page never sends someone wherever a link says.
 */
async function returnAddress(asked: string | string[] | undefined) {
  if (typeof asked !== "string" || !URL.canParse(asked)) return "/";
  const address = new URL(asked);
  if (address.protocol !== "https:") return "/";
  try {
    return (await fetchQuery(api.evidenceLibraries.sources.isCommunity, { origin: address.origin })) ? address.toString() : "/";
  } catch (error) {
    console.error(JSON.stringify({ event: "sign-out-return-check-failed", origin: address.origin, error: String(error).slice(0, 300) }));
    return "/";
  }
}

export default async function SignOutPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string | string[] }> }) {
  return <SignOut to={await returnAddress((await searchParams).redirect_url)} />;
}
