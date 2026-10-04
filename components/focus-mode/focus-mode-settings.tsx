import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, RotateCcw } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PaperContent } from "./paper-content";
import type { PaperContentProps } from "./paper-content";
import type { PaperResult } from "@/lib/types";

interface FocusModeSettingsConfig {
  fontSize: 'sm' | 'base' | 'lg' | 'xl';
  maxContentWidth: 'narrow' | 'medium' | 'wide' | 'full';
  lineHeight: 'tight' | 'normal' | 'relaxed';
  showMetadata: boolean;
  compactMode: boolean;
  setFontSize: (size: 'sm' | 'base' | 'lg' | 'xl') => void;
  setMaxContentWidth: (width: 'narrow' | 'medium' | 'wide' | 'full') => void;
  setLineHeight: (height: 'tight' | 'normal' | 'relaxed') => void;
  setShowMetadata: (show: boolean) => void;
  setCompactMode: (compact: boolean) => void;
  resetSettings: () => void;
}

export interface FocusModeSettingsProps {
  settings: FocusModeSettingsConfig;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  maxWidthClass: string;
  currentPaper: PaperResult;
  paperContentProps: Omit<PaperContentProps, "paper" | "isPreview">;
  onBack: () => void;
  tFocus: (key: string) => string;
  tFontSize: (key: string) => string;
  tLineHeight: (key: string) => string;
  tWidth: (key: string) => string;
  tCommon: (key: string) => string;
  tAccessibility: (key: string) => string;
}

export function FocusModeSettings({
  settings,
  theme,
  setTheme,
  maxWidthClass,
  currentPaper,
  paperContentProps,
  onBack,
  tFocus,
  tFontSize,
  tLineHeight,
  tWidth,
  tCommon,
  tAccessibility,
}: FocusModeSettingsProps) {
  return (
    <div
      className="h-full overflow-y-auto !outline-none"
      data-content-scroll
      tabIndex={0}
    >
      <div className={cn("mx-auto p-6", maxWidthClass)}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {tFocus("settingsTitle")}
            </h2>
            <p className="text-muted-foreground mt-1">
              {tFocus("settingsSubtitle")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={settings.resetSettings}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            {tCommon("reset")}
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Settings Controls */}
          <div className="space-y-8">
            {/* Typography Section */}
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  {tFocus("typography")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {tFocus("typographyDescription")}
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {tFocus("fontSize")}
                  </Label>
                  <Select
                    value={settings.fontSize}
                    onValueChange={settings.setFontSize}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sm">{tFontSize('small')}</SelectItem>
                      <SelectItem value="base">
                        {tFontSize('medium')}
                      </SelectItem>
                      <SelectItem value="lg">{tFontSize('large')}</SelectItem>
                      <SelectItem value="xl">
                        {tFontSize('extraLarge')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {tFocus("lineHeight")}
                  </Label>
                  <Select
                    value={settings.lineHeight}
                    onValueChange={settings.setLineHeight}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tight">
                        {tLineHeight('tight')}
                      </SelectItem>
                      <SelectItem value="normal">
                        {tLineHeight('normal')}
                      </SelectItem>
                      <SelectItem value="relaxed">
                        {tLineHeight('relaxed')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Layout Section */}
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">{tFocus("layout")}</h3>
                <p className="text-sm text-muted-foreground">
                  {tFocus("layoutDescription")}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {tFocus("contentWidth")}
                </Label>
                <Select
                  value={settings.maxContentWidth}
                  onValueChange={settings.setMaxContentWidth}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="narrow">
                        {tWidth('narrow')}
                      </SelectItem>
                      <SelectItem value="medium">
                        {tWidth('medium')}
                      </SelectItem>
                      <SelectItem value="wide">
                        {tWidth('wide')}
                      </SelectItem>
                      <SelectItem value="full">{tWidth('fullWidth')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Appearance Section */}
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  {tFocus("appearance")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {tFocus("appearanceDescription")}
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      {tFocus("darkMode")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {tFocus("darkModeDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={() =>
                      setTheme(theme === "dark" ? "light" : "dark")
                    }
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      {tFocus("showMetadata")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {tFocus("showMetadataDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={settings.showMetadata}
                    onCheckedChange={settings.setShowMetadata}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      {tFocus("compactMode")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {tFocus("compactModeDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={settings.compactMode}
                    onCheckedChange={settings.setCompactMode}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Preview Section */}
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">{tFocus("preview")}</h3>
              <p className="text-sm text-muted-foreground">
                {tFocus("previewDescription")}
              </p>
            </div>

            <div className="rounded-lg border bg-background">
              <PaperContent
                paper={currentPaper}
                isPreview={true}
                {...paperContentProps}
              />
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-8 pt-6 border-t">
          <Button
            onClick={onBack}
            className="w-full sm:w-auto gap-2"
            size="lg"
          >
            <ChevronLeft className="h-4 w-4" />
            {tFocus("backToContent")}
          </Button>
        </div>
      </div>
    </div>
  );
}
