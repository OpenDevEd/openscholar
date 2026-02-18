"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchHistoryClearAllButtonProps {
  onClick: () => void;
  disabled: boolean;
  variant?: "compact" | "full";
}

export function SearchHistoryClearAllButton({
  onClick,
  disabled,
  variant = "compact",
}: SearchHistoryClearAllButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-muted-foreground hover:text-destructive transition-colors self-start sm:self-auto",
        disabled && "opacity-50"
      )}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
