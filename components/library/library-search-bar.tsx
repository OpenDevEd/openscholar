"use client";

import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LibrarySearchBarProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  inputClassName?: string;
  clearButtonClassName?: string;
}

export function LibrarySearchBar({
  value,
  onChange,
  className,
  inputClassName,
  clearButtonClassName,
}: LibrarySearchBarProps) {
  const t = useTranslations("libraryPage");

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className={cn("pl-9 pr-9", inputClassName)}
      />
      {value.length > 0 && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange("")}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground",
            clearButtonClassName,
          )}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Clear search</span>
        </Button>
      )}
    </div>
  );
}
