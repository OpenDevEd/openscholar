import React from 'react';
import { Button } from "@/components/ui/button";
import { Download, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DownloadMenuProps {
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => void;
  onDownloadEssentialJSON?: () => void;
  onDownloadEssentialCSV?: () => void;
  onOpenFocusMode?: () => void;
  showFocusMode?: boolean;
  variant?: "icon" | "button";
  size?: "sm" | "default";
}

export function DownloadMenu({
  onDownloadJSON,
  onDownloadCSV,
  onDownloadEssentialJSON,
  onDownloadEssentialCSV,
  onOpenFocusMode,
  showFocusMode = false,
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
        {showFocusMode && onOpenFocusMode && (
          <DropdownMenuItem onClick={onOpenFocusMode}>
            <Eye className="h-4 w-4 mr-2" />
            Open in Focus Mode
          </DropdownMenuItem>
        )}
        {onDownloadJSON && (
          <DropdownMenuItem onClick={onDownloadJSON}>
            Download as JSON
          </DropdownMenuItem>
        )}
        {onDownloadCSV && (
          <DropdownMenuItem onClick={onDownloadCSV}>
            Download as CSV
          </DropdownMenuItem>
        )}
        {onDownloadEssentialJSON && (
          <DropdownMenuItem onClick={onDownloadEssentialJSON}>
            Download Essential Info as JSON
          </DropdownMenuItem>
        )}
        {onDownloadEssentialCSV && (
          <DropdownMenuItem onClick={onDownloadEssentialCSV}>
            Download Essential Info as CSV
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 