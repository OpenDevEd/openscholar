"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface TwoColumnLayoutProps {
  leftColumn: React.ReactNode;
  rightColumn: React.ReactNode;
  leftColumnWidth?: string;
  rightColumnClassName?: string;
  className?: string;
}

export function TwoColumnLayout({
  leftColumn,
  rightColumn,
  leftColumnWidth,
  rightColumnClassName,
  className,
}: TwoColumnLayoutProps) {
  return (
    <div className={cn("flex min-h-full", className)}>
      {/* Left Column - Filters/Sidebar */}
      <div
        className={cn(
          "shrink-0 sticky top-0 h-screen"
          // Removed leftColumnWidth from className as it's a value not a class
        )}
        style={{ width: leftColumnWidth }}
      >
        {leftColumn}
      </div>

      {/* Right Column - Main Content */}
      <div className={cn("flex-1 min-w-0 flex flex-col", rightColumnClassName)}>
        {rightColumn}
      </div>
    </div>
  );
}
