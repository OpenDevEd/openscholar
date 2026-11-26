import type { ReactNode } from "react";
import { ScreeningWorkspace } from "@/components/screening-mock/workspace";

// Mock (mock/screening-reviewers): the frame an open screening's three pages share. Each page has its own
// address, so Back returns to the page before, and the frame stays in place between them.
export default function ScreeningMockViewsLayout({ children }: { children: ReactNode }) {
  return <ScreeningWorkspace>{children}</ScreeningWorkspace>;
}
