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
    <div
      className={cn(
        // `min-h-0` is required so a `flex-1` child (e.g. a chat
        // message list) can become its own scroll container instead of
        // growing past the viewport and pushing siblings (composer)
        // off-screen. Without this, flex items keep their default
        // `min-height: auto`, which is what breaks scroll panes.
        "flex min-h-0 min-w-0 flex-1 flex-col",
        rightColumnClassName,
      )}
    >
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
