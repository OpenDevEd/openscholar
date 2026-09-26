"use client";

import { useEffect, useState, useRef } from "react";
import { X } from "lucide-react";
import { ListSearch } from "@/components/evidence-libraries/list-controls";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useTranslations } from "next-intl";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const resolvedPlaceholder = placeholder ?? t("searchPlaceholder");
  const [localValue, setLocalValue] = useState(() => value);
  const debouncedValue = useDebouncedValue(localValue, 300);
  const isInitialMount = useRef(true);

  // Only call onChange when debounced value changes, not on every render
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (debouncedValue !== value) {
      onChange(debouncedValue);
    }
  }, [debouncedValue]); // Intentionally omit onChange and value to prevent loop

  // Parent uses key={searchQueryResetKey} to remount when filters are reset; no sync effect needed

  return (
    <div className={cn("relative", className)}>
      <ListSearch
        aria-label={resolvedPlaceholder}
        placeholder={resolvedPlaceholder}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        className="w-full pr-8"
      />
      {localValue && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={tc("clear")}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
          onClick={() => {
            setLocalValue('');
            onChange('');
          }}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
