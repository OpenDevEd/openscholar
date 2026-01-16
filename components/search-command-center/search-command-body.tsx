"use client";

import React, { useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SearchMode } from "./search-mode";
import { AdjustMode } from "./adjust-mode";
import type { CommandCenterMode } from "./index";
import { subtleSpring } from "@/lib/animation-config";

interface SearchCommandBodyProps {
  mode: CommandCenterMode;
  searchId: string;
  isLoading?: boolean;
  isValidating?: boolean;
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
  isLoading,
  isValidating,
}: SearchCommandBodyProps) {
  const prevModeRef = useRef<CommandCenterMode>(mode);
  const directionRef = useRef<Direction>(1);

  useEffect(() => {
    if (prevModeRef.current !== mode) {
      // search → adjust = going right (1), adjust → search = going left (-1)
      directionRef.current = mode === "adjust" ? 1 : -1;
      prevModeRef.current = mode;
    }
  }, [mode]);

  return (
    <div className="relative overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout" custom={directionRef.current}>
        <motion.div
          key={mode}
          custom={directionRef.current}
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
            />
          ) : (
            <AdjustMode
              searchId={searchId}
              isLoading={isLoading}
              isValidating={isValidating}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
