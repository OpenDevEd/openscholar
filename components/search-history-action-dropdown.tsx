"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FileDown, FileUp } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

interface SearchHistoryActionDropdownProps {
  onDownloadJSON: () => void;
  onDownloadCSV: () => void;
  onUploadJSON: () => void;
  onUploadCSV: () => void;
  variant?: "compact" | "full";
}

export function SearchHistoryActionDropdown({
  onDownloadJSON,
  onDownloadCSV,
  onUploadJSON,
  onUploadCSV,
  variant = "compact",
}: SearchHistoryActionDropdownProps) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onDownloadJSON}>
          <FileDown className="h-4 w-4 mr-2" />
          {t("common.downloadAsJson")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDownloadCSV}>
          <FileDown className="h-4 w-4 mr-2" />
          {t("common.downloadAsCsv")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onUploadJSON}>
          <FileUp className="h-4 w-4 mr-2" />
          {t("common.uploadJson")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onUploadCSV}>
          <FileUp className="h-4 w-4 mr-2" />
          {t("common.uploadCsv")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
