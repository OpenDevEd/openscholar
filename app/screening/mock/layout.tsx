import type { ReactNode } from "react";
import { ScreeningMockProvider } from "@/components/screening-mock/store";

// Mock (mock/screening-reviewers): every page under here shares one made-up state, so a change on
// one page shows on the others.
export default function ScreeningMockLayout({ children }: { children: ReactNode }) {
  return <ScreeningMockProvider>{children}</ScreeningMockProvider>;
}
