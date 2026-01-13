"use client";

import React from "react";
import { AnimatePresence } from "framer-motion";
import { SearchMode } from "./search-mode";
import { AdjustMode } from "./adjust-mode";
import type { CommandCenterMode } from "./index";

interface SearchCommandBodyProps {
  mode: CommandCenterMode;
  searchId: string;
  isLoading?: boolean;
  isValidating?: boolean;
}

export function SearchCommandBody({
  mode,
  searchId,
  isLoading,
  isValidating,
}: SearchCommandBodyProps) {
  return (
    <div className="relative overflow-hidden">
      <AnimatePresence mode="wait">
        {mode === "search" ? (
          <SearchMode
            key="search-mode"
            isLoading={isLoading}
            isValidating={isValidating}
          />
        ) : (
          <AdjustMode
            key="adjust-mode"
            searchId={searchId}
            isLoading={isLoading}
            isValidating={isValidating}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
