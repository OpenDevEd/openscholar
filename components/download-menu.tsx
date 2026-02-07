"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import posthog from "posthog-js";

interface DownloadMenuProps {
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => void;
  onDownloadEssentialJSON?: () => void;
  onDownloadEssentialCSV?: () => void;
  variant?: "icon" | "button";
  size?: "sm" | "default";
}

export function DownloadMenu({
  onDownloadJSON,
  onDownloadCSV,
  onDownloadEssentialJSON,
  onDownloadEssentialCSV,
  variant = "icon",
  size = "default"
}: DownloadMenuProps) {
  const TriggerButton = variant === "icon" ? (
    <Button variant="ghost" size="icon">
      <Download className="h-4 w-4" />
    </Button>
  ) : (
    <Button variant="outline" size={size}>
      <Download className="h-4 w-4 mr-2" />
      Download All
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {TriggerButton}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onDownloadJSON && (
          <DropdownMenuItem onClick={() => {
            posthog.capture("results_downloaded", {
              format: "json",
              content_type: "full",
            });
            onDownloadJSON();
          }}>
            Download as JSON
          </DropdownMenuItem>
        )}
        {onDownloadCSV && (
          <DropdownMenuItem onClick={() => {
            posthog.capture("results_downloaded", {
              format: "csv",
              content_type: "full",
            });
            onDownloadCSV();
          }}>
            Download as CSV
          </DropdownMenuItem>
        )}
        {onDownloadEssentialJSON && (
          <DropdownMenuItem onClick={() => {
            posthog.capture("results_downloaded", {
              format: "json",
              content_type: "essential",
            });
            onDownloadEssentialJSON();
          }}>
            Download Essential Info as JSON
          </DropdownMenuItem>
        )}
        {onDownloadEssentialCSV && (
          <DropdownMenuItem onClick={() => {
            posthog.capture("results_downloaded", {
              format: "csv",
              content_type: "essential",
            });
            onDownloadEssentialCSV();
          }}>
            Download Essential Info as CSV
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 