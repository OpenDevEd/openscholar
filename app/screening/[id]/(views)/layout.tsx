import type { ReactNode } from "react";
import { ScreeningWorkspace } from "@/components/screening/workspace";

// The frame an open screening's pages share. Each page has its own address, so Back returns to the page
// before, and the frame stays in place between them.
export default function ScreeningViewsLayout({ children }: { children: ReactNode }) {
  return <ScreeningWorkspace>{children}</ScreeningWorkspace>;
}
