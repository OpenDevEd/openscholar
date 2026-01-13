"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Quote,
  Network,
  FileText,
  ExternalLink,
  Check,
  X,
  Minus,
  Users,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ==================== Types ====================

export interface PaperCardProps {
  result: any;
  resultIndex: number;
  onDownloadItem: (item: any, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: any, format: "json" | "csv") => void;
  viewMode?: "list-simple" | "list-detail" | "grid-2" | "grid-3";
}

export interface ScreeningBadgeProps {
  displayState: "checked" | "crossed" | "unchecked" | "loading";
  index: number;
  question: string;
  variant?: "default" | "icon-only";
}

// ==================== Utility Functions ====================

export function truncateAuthors(
  authorships: { author: { display_name: string } }[],
  maxLength: number = 100
): string {
  if (!authorships || authorships.length === 0) return "";
  
  const names = authorships.map((a) => a.author.display_name);
  let result = names[0];
  
  for (let i = 1; i < names.length; i++) {
    const next = `${result}, ${names[i]}`;
    if (next.length > maxLength) {
      return `${result} et al.`;
    }
    result = next;
  }
  
  return result;
}

export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function getFirstAuthor(
  authorships: { author: { display_name: string } }[]
): string {
  if (!authorships || authorships.length === 0) return "";
  const first = authorships[0].author.display_name;
  if (authorships.length > 1) {
    return `${first} et al.`;
  }
  return first;
}

// ==================== Shared Components ====================

export function ScreeningBadge({
  displayState,
  index,
  question,
  variant = "default",
}: ScreeningBadgeProps) {
  const baseClasses = cn(
    "flex items-center gap-1 rounded border text-xs transition-colors",
    variant === "icon-only" ? "p-1" : "px-2 py-1"
  );

  const stateClasses = {
    checked: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400",
    crossed: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
    loading: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400 cursor-wait",
    unchecked: "bg-muted/50 border-border text-muted-foreground",
  };

  return (
    <div
      className={cn(baseClasses, stateClasses[displayState])}
      title={`Question ${index + 1}: ${question}`}
    >
      {displayState === "checked" && <Check className="h-3 w-3" />}
      {displayState === "crossed" && <X className="h-3 w-3" />}
      {displayState === "unchecked" && <Minus className="h-3 w-3" />}
      {displayState === "loading" && (
        <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
      )}
      {variant !== "icon-only" && <span className="font-mono">{index + 1}</span>}
    </div>
  );
}

export function CitationBadge({
  count,
  label,
  color,
  onClick,
  compact = false,
}: {
  count: number;
  label: string;
  color: "orange" | "green" | "blue";
  onClick?: () => void;
  compact?: boolean;
}) {
  const colorClasses = {
    orange: "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/50",
    green: "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/50",
    blue: "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50",
  };

  const Icon = color === "blue" ? Network : Quote;

  if (compact) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
          colorClasses[color]
        )}
        title={label}
      >
        <Icon className="h-3 w-3" />
        <span>{count}</span>
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("flex items-center gap-2 flex-shrink-0", colorClasses[color])}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span className="text-sm">{label}: {count}</span>
    </Button>
  );
}

export function OpenAccessBadge({
  isOA,
  oaUrl,
  compact = false,
}: {
  isOA: boolean;
  oaUrl?: string;
  compact?: boolean;
}) {
  if (!isOA || !oaUrl) return null;

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => window.open(oaUrl, "_blank")}
        onKeyDown={(e) => e.key === "Enter" && window.open(oaUrl, "_blank")}
        className="flex items-center justify-center p-1.5 rounded-md text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/50 transition-colors cursor-pointer"
        title="Open Access PDF"
      >
        <FileText className="h-4 w-4" />
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(oaUrl, "_blank")}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(oaUrl, "_blank");
        }
      }}
      className="flex items-center gap-2 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 cursor-pointer flex-shrink-0"
      title="Open Access PDF"
    >
      <FileText className="h-4 w-4" />
      <span>PDF</span>
    </Button>
  );
}

export function DOIBadge({
  doi,
  compact = false,
}: {
  doi: string;
  compact?: boolean;
}) {
  if (!doi) return null;

  const doiUrl = doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
  const shortDoi = doi.replace("https://doi.org/", "");

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => window.open(doiUrl, "_blank")}
        onKeyDown={(e) => e.key === "Enter" && window.open(doiUrl, "_blank")}
        className="flex items-center justify-center p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors cursor-pointer"
        title={`DOI: ${shortDoi}`}
      >
        <ExternalLink className="h-4 w-4" />
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(doiUrl, "_blank")}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(doiUrl, "_blank");
        }
      }}
      className="flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50 cursor-pointer flex-shrink-0"
      title="Open DOI"
    >
      <ExternalLink className="h-3 w-3" />
      <span className="text-xs font-mono">{shortDoi}</span>
    </Button>
  );
}

export function AuthorsLine({
  authorships,
  maxLength = 200,
  className,
}: {
  authorships: { author: { display_name: string } }[];
  maxLength?: number;
  className?: string;
}) {
  if (!authorships || authorships.length === 0) return null;

  return (
    <div className={cn("flex gap-2 text-sm text-muted-foreground", className)}>
      <Users className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="line-clamp-1">{truncateAuthors(authorships, maxLength)}</span>
    </div>
  );
}

export function JournalLine({
  source,
  biblio,
  className,
}: {
  source?: { display_name: string };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  className?: string;
}) {
  if (!source?.display_name) return null;

  return (
    <div className={cn("flex gap-2 text-sm text-muted-foreground", className)}>
      <BookOpen className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="italic line-clamp-1">
        {source.display_name}
        {biblio?.volume && `, Vol. ${biblio.volume}`}
        {biblio?.issue && ` (${biblio.issue})`}
        {biblio?.first_page && (
          <>
            {`, pp. ${biblio.first_page}`}
            {biblio?.last_page && `-${biblio.last_page}`}
          </>
        )}
      </span>
    </div>
  );
}

// Card container styles matching the design language
export const cardContainerClasses = {
  base: cn(
    "relative group rounded-2xl border transition-all duration-200",
    "bg-background/80 dark:bg-background/60",
    "border-border/60 dark:border-border/40",
    "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
    "backdrop-blur-xl backdrop-saturate-150"
  ),
  hover: cn(
    "hover:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent/30",
    "hover:border-primary/20 dark:hover:border-primary/30",
    "hover:shadow-xl hover:shadow-black/[0.05] dark:hover:shadow-black/[0.15]",
    "hover:-translate-y-0.5"
  ),
  focus: cn(
    "focus-within:ring-2 focus-within:ring-primary/10",
    "focus-within:border-primary/50"
  ),
};

export function CardContainer({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        cardContainerClasses.base,
        cardContainerClasses.hover,
        cardContainerClasses.focus,
        "@container/card",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
