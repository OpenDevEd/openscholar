import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SETUP_HEADER } from "@/lib/profile/setup";

/**
 * What the proxy renders in place of the page asked for while a new account's profile setup is due (proxy.ts): the
 * root layout draws the setup alone, so this page draws nothing, and the page asked for never runs. It isn't a page
 * of its own: opened by its address, it is missing.
 */
export default async function ProfileSetupPage() {
  if ((await headers()).get(SETUP_HEADER) !== "due") notFound();
  return null;
}
