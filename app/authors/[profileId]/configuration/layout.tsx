import type { ReactNode } from "react";
import { OrganizationFeatureGate } from "@/components/auth/organization-feature-gate";

export default function Layout({ children }: { children: ReactNode }) {
  return <OrganizationFeatureGate feature="authors">{children}</OrganizationFeatureGate>;
}
