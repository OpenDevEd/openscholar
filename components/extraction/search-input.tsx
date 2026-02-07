"use client";

import { useEffect, useState, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search...", className }: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
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

  // Sync local value with external value changes
  useEffect(() => {
    if (value !== localValue && value !== debouncedValue) {
      setLocalValue(value);
    }
  }, [value]); // Intentionally omit localValue and debouncedValue

  return (
    <div className={`relative flex-1 ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="pl-10 pr-10 h-9 bg-muted/30 dark:bg-muted/20 border-border/50 placeholder:text-muted-foreground/60"
      />
      {localValue && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => {
            setLocalValue('');
            onChange('');
          }}
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
