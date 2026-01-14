"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ContentScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

export function ContentScrollArea({ children, className, footer }: ContentScrollAreaProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scrollable Content Area */}
      <div className={cn(
        "flex-1 min-h-0 overflow-y-auto",
        "scrollbar-hover",
        className
      )}>
        {children}
      </div>
      
      {/* Footer - Fixed at bottom */}
      {footer && (
        <div className="shrink-0 border-t bg-background/95 backdrop-blur">
          {footer}
        </div>
      )}
    </div>
  );
}
