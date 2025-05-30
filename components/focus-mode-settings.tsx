import React from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Settings, RotateCcw } from "lucide-react";
import { useFocusModeSettingsStore } from "@/lib/store";
import { useTheme } from 'next-themes';

export function FocusModeSettings() {
  const {
    fontSize,
    maxContentWidth,
    lineHeight,
    showMetadata,
    compactMode,
    setFontSize,
    setMaxContentWidth,
    setLineHeight,
    setShowMetadata,
    setCompactMode,
    resetSettings,
  } = useFocusModeSettingsStore();
  
  const { theme, setTheme } = useTheme();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Focus Mode Settings</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetSettings}
              className="h-8 w-8 p-0"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>

          {/* Font Size */}
          <div className="space-y-2">
            <Label htmlFor="font-size">Font Size</Label>
            <Select value={fontSize} onValueChange={setFontSize}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">Small</SelectItem>
                <SelectItem value="base">Medium</SelectItem>
                <SelectItem value="lg">Large</SelectItem>
                <SelectItem value="xl">Extra Large</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Line Height */}
          <div className="space-y-2">
            <Label htmlFor="line-height">Line Height</Label>
            <Select value={lineHeight} onValueChange={setLineHeight}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tight">Tight</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="relaxed">Relaxed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Max Content Width */}
          <div className="space-y-2">
            <Label htmlFor="content-width">Content Width</Label>
            <Select value={maxContentWidth} onValueChange={setMaxContentWidth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="narrow">Narrow (600px)</SelectItem>
                <SelectItem value="medium">Medium (800px)</SelectItem>
                <SelectItem value="wide">Wide (1000px)</SelectItem>
                <SelectItem value="full">Full Width</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Toggle Settings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="dark-mode" className="text-sm font-normal">
                Dark Mode
              </Label>
              <Switch
                id="dark-mode"
                checked={theme === 'dark'}
                onCheckedChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-metadata" className="text-sm font-normal">
                Show Metadata
              </Label>
              <Switch
                id="show-metadata"
                checked={showMetadata}
                onCheckedChange={setShowMetadata}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="compact-mode" className="text-sm font-normal">
                Compact Mode
              </Label>
              <Switch
                id="compact-mode"
                checked={compactMode}
                onCheckedChange={setCompactMode}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
} 