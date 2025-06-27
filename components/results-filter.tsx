"use client";

import React from 'react';
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface ResultsFilterProps {
  value: string;
  onChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
}

export function ResultsFilter({ value, onChange, filteredCount, totalCount }: ResultsFilterProps) {
  return (
    <div className="flex-shrink-0 mb-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search within results..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
        />
      </div>
      {value && (
        <div className="mt-2 text-xs text-muted-foreground">
          Showing {filteredCount} of {totalCount} results
        </div>
      )}
    </div>
  );
} 