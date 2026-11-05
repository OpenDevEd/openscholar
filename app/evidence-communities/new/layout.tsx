import type { ReactNode } from "react";
import { EvidenceLibrariesGate } from "@/components/auth/evidence-libraries-gate";

export default function Layout({ children }: { children: ReactNode }) {
  return <EvidenceLibrariesGate>{children}</EvidenceLibrariesGate>;
}
