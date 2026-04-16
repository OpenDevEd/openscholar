/** DataTable renderer bridging TanStack Table headless API to shadcn Table primitives via flexRender. Phase 101: WB-01. */
"use client";

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { flexRender, type Table as TanStackTable } from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface WorkbenchDataTableProps<T> {
  table: TanStackTable<T>;
  className?: string;
}

export function WorkbenchDataTable<T>({
  table,
  className,
}: WorkbenchDataTableProps<T>) {
  const t = useTranslations("extraction");
  const hasColumnFilters = table.getState().columnFilters.length > 0;

  return (
    <Table className={className}>
      <TableHeader className="sticky top-0 z-10 bg-card">
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const canSort = header.column.getCanSort();
              const sorted = header.column.getIsSorted();

              return (
                <TableHead
                  key={header.id}
                  className={cn(
                    "font-semibold",
                    canSort && "cursor-pointer select-none group",
                  )}
                  onClick={
                    canSort
                      ? header.column.getToggleSortingHandler()
                      : undefined
                  }
                >
                  {header.isPlaceholder ? null : (
                    <span className="inline-flex items-center">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {canSort && sorted === "asc" && (
                        <ArrowUp className="ml-1 inline h-3.5 w-3.5 text-primary" />
                      )}
                      {canSort && sorted === "desc" && (
                        <ArrowDown className="ml-1 inline h-3.5 w-3.5 text-primary" />
                      )}
                      {canSort && !sorted && (
                        <ArrowUpDown className="ml-1 inline h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length > 0 ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="h-12">
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={table.getAllColumns().length}
              className="h-24 text-center text-muted-foreground"
            >
              {hasColumnFilters
                ? t("workbench.noResults")
                : t("workbench.noData")}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
