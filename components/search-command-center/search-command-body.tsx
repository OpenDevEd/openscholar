"use client";

import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { SearchMode } from "./search-mode";
import { AdjustMode } from "./adjust-mode";
import type { CommandCenterMode } from "./types";
import { subtleSpring } from "@/lib/animation-config";

interface SearchCommandBodyProps {
  mode: CommandCenterMode;
  searchId: string;
  currentQuery: string;
  isLoading?: boolean;
  isValidating?: boolean;
  allowEmpty?: boolean;
}

// Direction: 1 = going right (search → adjust), -1 = going left (adjust → search)
type Direction = 1 | -1;

const slideVariants = {
  enter: (direction: Direction) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: Direction) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
  }),
};

export function SearchCommandBody({
  mode,
  searchId,
  currentQuery,
  isLoading,
  isValidating,
  allowEmpty = false,
}: SearchCommandBodyProps) {
  // search → adjust = going right (1), adjust → search = going left (-1)
  const direction: Direction = mode === "adjust" ? 1 : -1;

  return (
    <div className="relative overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.div
          key={mode}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={subtleSpring}
        >
          {mode === "search" ? (
            <SearchMode
              isLoading={isLoading}
              isValidating={isValidating}
              allowEmpty={allowEmpty}
            />
          ) : (
            <AdjustMode
              searchId={searchId}
              isLoading={isLoading}
              isValidating={isValidating}
              allowEmpty={allowEmpty}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
