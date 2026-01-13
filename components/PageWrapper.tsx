"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Footer } from "@/components/ui/footer";

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
  removeOverflow?: boolean;
}

export function PageWrapper({ children, className, removeOverflow = false }: PageWrapperProps) {
  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className={cn("flex-1 min-h-0 flex flex-col", !removeOverflow && "overflow-y-auto")}>
        {children}
        <Footer />
      </div>
    </div>
  );
}
