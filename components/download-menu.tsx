"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Download } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import posthog from "posthog-js";
import { useTranslations } from "next-intl";

interface DownloadMenuProps {
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => void;
  onDownloadEssentialJSON?: () => void;
  onDownloadEssentialCSV?: () => void;
  /** `outline` is an icon button that matches the focus mode header's outline buttons. */
  variant?: "icon" | "outline" | "button";
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
  const t = useTranslations("downloads");
  const tc = useTranslations("common");

  const TriggerButton = variant === "icon" ? (
    <Button variant="ghost" size="icon" aria-label={tc("download")}>
      <Download className="h-4 w-4" />
    </Button>
  ) : variant === "outline" ? (
    <Button variant="outline" size="icon-sm" aria-label={tc("download")}>
      <Download className="h-3 w-3" />
    </Button>
  ) : (
    <Button variant="outline" size={size}>
      <Download className="h-4 w-4 me-2" />
      {t("downloadAll")}
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
            {tc("downloadAsJson")}
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
            {tc("downloadAsCsv")}
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
            {t("downloadEssentialJSON")}
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
            {t("downloadEssentialCSV")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
