"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface TwoColumnLayoutProps {
  leftColumn: React.ReactNode;
  rightColumn: React.ReactNode;
  rightColumnClassName?: string;
  className?: string;
  /**
   * Which side the sticky sidebar slot sits on. Defaults to "left" so
   * every existing consumer (search filters, library, extraction
   * citations) keeps its current layout; pass "right" for pages whose
   * sidebar complements the content on the opposite edge (e.g. the
   * job-creator's bucket sidebar). Only affects the *visual* order —
   * `leftColumn` always refers to the sticky sidebar slot regardless.
   */
  sidebarSide?: "left" | "right";
}

export function TwoColumnLayout({
  leftColumn,
  rightColumn,
  rightColumnClassName,
  className,
  sidebarSide = "left",
}: TwoColumnLayoutProps) {
  const sidebar = (
    <div className="shrink-0 sticky top-0 h-screen overflow-hidden">
      {leftColumn}
    </div>
  );
  const content = (
    <div className={cn("flex-1 min-w-0 flex flex-col", rightColumnClassName)}>
      {rightColumn}
    </div>
  );
  return (
    <div className={cn("flex min-h-full", className)}>
      {sidebarSide === "left" ? (
        <>
          {sidebar}
          {content}
        </>
      ) : (
        <>
          {content}
          {sidebar}
        </>
      )}
    </div>
  );
}
