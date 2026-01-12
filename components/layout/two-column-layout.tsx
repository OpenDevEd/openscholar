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
  className 
}: TwoColumnLayoutProps) {
  return (
    <div className={cn("flex h-full overflow-hidden", className)}>
      {/* Left Column - Filters/Sidebar */}
      <div 
        className={cn(
          "shrink-0 overflow-hidden",
          leftColumnWidth
        )}
      >
        {leftColumn}
      </div>
      
      {/* Right Column - Main Content */}
      <div className={cn(
        "flex-1 min-w-0 overflow-hidden flex flex-col",
        rightColumnClassName
      )}>
        {rightColumn}
      </div>
    </div>
  );
}
