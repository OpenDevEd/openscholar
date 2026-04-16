/** Segmented control for workbench view switching (table/card/split). Reuses CompactIconToggleGroup. Phase 101: D-08. */
"use client";

import { Table2, LayoutGrid, Columns } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  CompactIconToggleGroup,
  type CompactIconToggleOption,
} from "@/components/view-mode-toggle";
import type { ActiveView } from "@/lib/store/extraction-results-view";

interface ViewSwitcherProps {
  value: ActiveView;
  onChange: (view: ActiveView) => void;
}

export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  const t = useTranslations("extraction");

  const viewOptions: CompactIconToggleOption<ActiveView>[] = [
    {
      value: "table",
      icon: <Table2 className="h-4 w-4" />,
      label: t("workbench.viewTable"),
    },
    {
      value: "card",
      icon: <LayoutGrid className="h-4 w-4" />,
      label: t("workbench.viewCard"),
    },
    {
      value: "split",
      icon: <Columns className="h-4 w-4" />,
      label: t("workbench.viewSplit"),
    },
  ];

  return (
    <CompactIconToggleGroup
      value={value}
      onChange={onChange}
      options={viewOptions}
    />
  );
}
