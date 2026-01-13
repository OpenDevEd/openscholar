"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Footer } from "@/components/ui/footer";

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export function PageWrapper({ children, className }: PageWrapperProps) {
  return (
    <div className={cn("flex-1 flex flex-col min-h-0 overflow-y-auto", className)}>
      <div className="flex-1">
        {children}
      </div>
      <Footer />
    </div>
  );
}
