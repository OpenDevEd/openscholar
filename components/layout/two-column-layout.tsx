"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface TwoColumnLayoutProps {
  leftColumn: React.ReactNode;
  rightColumn: React.ReactNode;
  rightColumnClassName?: string;
  className?: string;
}

export function TwoColumnLayout({
  leftColumn,
  rightColumn,
  rightColumnClassName,
  className,
}: TwoColumnLayoutProps) {
  return (
    <div className={cn("flex min-h-full", className)}>
      {/* Left Column - Filters/Sidebar */}
      <div className="shrink-0 sticky top-0 h-screen overflow-hidden">
        {leftColumn}
      </div>

      {/* Right Column - Main Content */}
      <div className={cn("flex-1 min-w-0 flex flex-col", rightColumnClassName)}>
        {rightColumn}
      </div>
    </div>
  );
}
