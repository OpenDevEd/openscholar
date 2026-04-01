"use client";

import { cn } from "@/lib/utils";
import { Search, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";

export type SearchMode = "search" | "research";

interface ModeToggleProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  disabled?: boolean;
}

const win2kTabStyle: React.CSSProperties = {
  fontFamily: "Tahoma, 'MS Sans Serif', Arial, sans-serif",
  fontSize: "11px",
  padding: "4px 12px",
  cursor: "default",
  userSelect: "none",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  border: "1px solid",
  borderRadius: "4px 4px 0 0",
  position: "relative",
  top: "1px",
};

export function ModeToggle({ mode, onModeChange, disabled }: ModeToggleProps) {
  const t = useTranslations("home");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "2px",
        fontFamily: "Tahoma, Arial, sans-serif",
      }}
    >
      <button
        type="button"
        onClick={() => !disabled && onModeChange("search")}
        disabled={disabled}
        style={{
          ...win2kTabStyle,
          background: mode === "search" ? "#d4d0c8" : "#bfbbb0",
          borderColor:
            mode === "search"
              ? "#ffffff #808080 #d4d0c8 #ffffff"
              : "#ffffff #808080 #808080 #ffffff",
          fontWeight: mode === "search" ? "bold" : "normal",
          color: disabled ? "#808080" : "#000",
          zIndex: mode === "search" ? 2 : 1,
          paddingTop: mode === "search" ? "6px" : "4px",
        }}
      >
        <Search size={11} />
        {t("searchMode")}
      </button>

      <button
        type="button"
        onClick={() => !disabled && onModeChange("research")}
        disabled={disabled}
        style={{
          ...win2kTabStyle,
          background: mode === "research" ? "#d4d0c8" : "#bfbbb0",
          borderColor:
            mode === "research"
              ? "#ffffff #808080 #d4d0c8 #ffffff"
              : "#ffffff #808080 #808080 #ffffff",
          fontWeight: mode === "research" ? "bold" : "normal",
          color: disabled ? "#808080" : "#000000",
          zIndex: mode === "research" ? 2 : 1,
          paddingTop: mode === "research" ? "6px" : "4px",
        }}
      >
        <Wand2 size={11} />
        {t("researchMode")}
      </button>
    </div>
  );
}
