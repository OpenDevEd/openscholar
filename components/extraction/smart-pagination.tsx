"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SmartPaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  totalCount: number;
  filteredCount: number;
  displayedCount: number;
}

export function SmartPagination({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  totalCount,
  filteredCount,
  displayedCount,
}: SmartPaginationProps) {
  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, filteredCount);

  if (filteredCount === 0) {
    return null;
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t bg-card/50 rounded-b-xl">
      {/* Left: Results info */}
      <div className="text-sm text-muted-foreground">
        Showing {startIdx}-{endIdx} of {filteredCount} paper{filteredCount !== 1 ? 's' : ''}
        {filteredCount < totalCount && (
          <span className="text-xs ml-2">
            (filtered from {totalCount})
          </span>
        )}
      </div>

      {/* Center: Page navigation */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => onPageChange(currentPage - 1)}
                className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>

            {/* Page number display */}
            <PaginationItem>
              <div className="flex items-center gap-2 px-4">
                <span className="text-sm">Page</span>
                <Select
                  value={currentPage.toString()}
                  onValueChange={(v) => onPageChange(Number(v))}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                      <SelectItem key={page} value={page.toString()}>
                        {page}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">of {totalPages}</span>
              </div>
            </PaginationItem>

            <PaginationItem>
              <PaginationNext
                onClick={() => onPageChange(currentPage + 1)}
                className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* Right: Page size selector */}
      <Select value={pageSize.toString()} onValueChange={(v) => onPageSizeChange(Number(v))}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="25">25 per page</SelectItem>
          <SelectItem value="50">50 per page</SelectItem>
          <SelectItem value="100">100 per page</SelectItem>
          <SelectItem value="200">200 per page</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
