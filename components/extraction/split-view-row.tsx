"use client";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/extraction/status-badge";
import { cn } from "@/lib/utils";
import type { WorkbenchPaper } from "@/lib/extraction/workbench-columns";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SplitViewRowProps {
  paper: WorkbenchPaper;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SplitViewRow({ paper, isSelected, onSelect }: SplitViewRowProps) {
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={isSelected}
      className={cn(
        "flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/40",
        isSelected && "bg-accent border-l-2 border-l-primary",
        !isSelected && "hover:bg-muted/50",
        "transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
      onClick={() => onSelect(paper._id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(paper._id);
        }
      }}
    >
      <StatusBadge status={paper.status} />
      {paper.parsingSource && (
        <Badge variant="secondary" className="text-xs shrink-0">
          {paper.parsingSource}
        </Badge>
      )}
      <span className="text-sm truncate flex-1">{paper.title}</span>
    </div>
  );
}
