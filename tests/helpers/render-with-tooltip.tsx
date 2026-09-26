import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

export function renderWithTooltip(ui: ReactElement) {
  // A wrapper, so rerender keeps the provider too.
  return render(ui, { wrapper: TooltipProvider });
}
