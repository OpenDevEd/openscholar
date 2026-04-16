/** Popover with column visibility checkboxes for the workbench table. Phase 101: WB-02. */
"use client";

import { Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Table as TanStackTable } from "@tanstack/react-table";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ColumnVisibilityToggleProps<T> {
  table: TanStackTable<T>;
}

export function ColumnVisibilityToggle<T>({
  table,
}: ColumnVisibilityToggleProps<T>) {
  const t = useTranslations("extraction");

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Settings2 className="h-4 w-4" />
                <span className="text-sm font-semibold">
                  {t("workbench.columns")}
                </span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("workbench.columns")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-[220px] p-3">
        {/* Toggle all checkbox */}
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            checked={table.getIsAllColumnsVisible()}
            onCheckedChange={(value) =>
              table.toggleAllColumnsVisible(!!value)
            }
          />
          <label className="text-sm font-semibold">
            {t("workbench.toggleAll")}
          </label>
        </div>
        <Separator className="mb-2" />
        {/* Individual column checkboxes */}
        <div className="max-h-[300px] overflow-y-auto">
          {table.getAllLeafColumns().map((column) => {
            if (!column.getCanHide()) return null;
            return (
              <div
                key={column.id}
                className="flex items-center gap-2 py-1.5 px-2"
              >
                <Checkbox
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(!!value)
                  }
                />
                <label className="text-sm truncate">
                  {typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : column.id}
                </label>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
