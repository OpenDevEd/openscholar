import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/**
 * Re-reads the user's account from Autumn as the billing page opens, so edits
 * made in Autumn's dashboard that send no webhook (a balance grant, say) show.
 * The page still renders if Autumn is slow or down; it shows the cached copy.
 */
export default async function BillingLayout({ children }: { children: ReactNode }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  if (token) {
    await fetchAction(api.billing.accounts.refreshMine, {}, { token }).catch((error) => {
      console.error("[billing] couldn't refresh the account from Autumn", error);
    });
  }
  return children;
}
