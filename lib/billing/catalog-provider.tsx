/**
 * BillingCatalogProvider
 * ======================
 * Autumn's plans and features, preloaded by the root layout so pricing and
 * plan labels render on the first frame, and kept live after that.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { api } from "@/convex/_generated/api";
import type { BillingCatalog } from "@/convex/billing/validators";

const BillingCatalogContext = createContext<BillingCatalog | null>(null);

export function BillingCatalogProvider({
  preloadedCatalog,
  children,
}: {
  preloadedCatalog: Preloaded<typeof api.billing.catalog.get>;
  children: ReactNode;
}) {
  const catalog = usePreloadedQuery(preloadedCatalog);
  return <BillingCatalogContext.Provider value={catalog}>{children}</BillingCatalogContext.Provider>;
}

/** The catalog, or null before Autumn's first sync. */
export function useBillingCatalog(): BillingCatalog | null {
  return useContext(BillingCatalogContext);
}
