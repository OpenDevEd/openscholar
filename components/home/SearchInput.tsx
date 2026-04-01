"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Loader2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModeToggle, SearchMode } from "./ModeToggle";
import { useTranslations } from "next-intl";

interface SearchInputProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: (e: React.FormEvent, mode: SearchMode) => void;
  isEnhancing: boolean;
  disabled: boolean;
  className?: string;
}

const win2kBtn: React.CSSProperties = {
  fontFamily: "Tahoma, 'MS Sans Serif', Arial, sans-serif",
  fontSize: "11px",
  padding: "3px 10px",
  background: "#d4d0c8",
  border: "2px solid",
  borderColor: "#ffffff #808080 #808080 #ffffff",
  cursor: "default",
  color: "#000",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  userSelect: "none",
  minWidth: "80px",
  justifyContent: "center",
};

const win2kBtnActive: React.CSSProperties = {
  borderColor: "#808080 #ffffff #ffffff #808080",
  paddingTop: "4px",
  paddingLeft: "11px",
};

export function SearchInput({
  query,
  onQueryChange,
  onSubmit,
  isEnhancing,
  disabled,
  className,
}: SearchInputProps) {
  const t = useTranslations("home");
  const tc = useTranslations("common");

  const [mode, setMode] = useState<SearchMode>("search");
  const effectiveMode = query.trim().endsWith("?") ? "research" : mode;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [searchPressed, setSearchPressed] = useState(false);

  useEffect(() => {
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: fine) and (min-width: 768px)").matches;
    if (isDesktop && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(e, effectiveMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
    if (e.key === "?" && !e.shiftKey && effectiveMode === "search") {
      e.preventDefault();
      setMode("research");
    }
  };

  const isResearch = effectiveMode === "research";

  return (
    <div
      className={cn("w-full max-w-2xl mx-auto relative z-10", className)}
      style={{ fontFamily: "Tahoma, 'MS Sans Serif', Arial, sans-serif" }}
    >
      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "flex-end", paddingLeft: "4px" }}>
        <ModeToggle
          mode={effectiveMode}
          onModeChange={setMode}
          disabled={disabled}
        />
      </div>

      {/* Win2000 group-box / panel */}
      <div
        style={{
          background: "#d4d0c8",
          border: "2px solid",
          borderColor: "#ffffff #808080 #808080 #ffffff",
          padding: "12px",
          boxShadow: "inset 1px 1px 0 #dfdfdf",
        }}
      >
        {/* Inner sunken textarea */}
        <div
          style={{
            background: "white",
            border: "2px solid",
            borderColor: "#808080 #dfdfdf #dfdfdf #808080",
            marginBottom: "10px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={query}
            placeholder={
              isResearch ? t("researchPlaceholder") : t("searchPlaceholder")
            }
            disabled={disabled}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: "100%",
              minHeight: "80px",
              resize: "none",
              border: "none",
              outline: "none",
              padding: "6px 8px",
              fontFamily: "Tahoma, Arial, sans-serif",
              fontSize: "13px",
              color: "#000",
              background: "transparent",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Action Row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          {/* Keyboard hint */}
          <div
            style={{
              fontSize: "11px",
              color: "#444",
              display: "flex",
              flexWrap: "wrap",
              gap: "4px",
              alignItems: "center",
            }}
          >
            <kbd
              style={{
                background: "#d4d0c8",
                border: "1px solid",
                borderColor: "#ffffff #808080 #808080 #ffffff",
                padding: "1px 4px",
                fontFamily: "Tahoma, monospace",
                fontSize: "10px",
              }}
            >
              {t("enterKey")}
            </kbd>
            {t("toSubmit")}
            <span style={{ opacity: 0.4 }}>|</span>
            <kbd
              style={{
                background: "#d4d0c8",
                border: "1px solid",
                borderColor: "#ffffff #808080 #808080 #ffffff",
                padding: "1px 4px",
                fontFamily: "Tahoma, monospace",
                fontSize: "10px",
              }}
            >
              {t("shiftEnterKey")}
            </kbd>
            {t("newLine")}
          </div>

          {/* Search Button */}
          <button
            type="button"
            onClick={(e) => {
              if (disabled || !query.trim()) return;
              setSearchPressed(true);
              setTimeout(() => setSearchPressed(false), 150);
              handleSubmit(e as unknown as React.FormEvent);
            }}
            disabled={disabled || !query.trim()}
            style={{
              ...win2kBtn,
              ...(searchPressed ? win2kBtnActive : {}),
              opacity: disabled || !query.trim() ? 0.5 : 1,
              cursor: disabled || !query.trim() ? "default" : "default",
              background: isResearch ? "#d4e8f5" : "#d4d0c8",
            }}
            onMouseDown={() => setSearchPressed(true)}
            onMouseUp={() => setSearchPressed(false)}
            onMouseLeave={() => setSearchPressed(false)}
          >
            {isEnhancing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {tc("processing")}
              </>
            ) : isResearch ? (
              <>
                <Wand2 size={12} />
                {t("researchButton")}
              </>
            ) : (
              <>
                <Search size={12} />
                {tc("search")}
              </>
            )}
          </button>
        </div>

        {/* Hint / research mode note */}
        <div
          style={{
            marginTop: "10px",
            borderTop: "1px solid #808080",
            paddingTop: "6px",
            minHeight: "20px",
          }}
        >
          {isResearch ? (
            <p style={{ fontSize: "11px", color: "#000080", margin: 0 }}>
              {t("researchModeDescription")}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setMode("research")}
              style={{
                fontSize: "11px",
                color: "#0000cc",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
                fontFamily: "Tahoma, Arial, sans-serif",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span
                style={{
                  background: "#d4d0c8",
                  border: "1px solid",
                  borderColor: "#ffffff #808080 #808080 #ffffff",
                  padding: "0 3px",
                  fontFamily: "monospace",
                  color: "#000",
                  fontSize: "10px",
                  textDecoration: "none",
                }}
              >
                ?
              </span>
              {t("questionShortcutHint")}
            </button>
          )}
        </div>
      </div>

      {/* Win2000 status bar */}
      <div
        style={{
          background: "#d4d0c8",
          borderTop: "1px solid #808080",
          padding: "2px 6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "11px",
          color: "#000",
        }}
      >
        <span>{isEnhancing ? "Processing search query..." : isResearch ? "Research mode enabled" : "Ready"}</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isEnhancing ? "#ffc107" : "#4caf50",
              border: "1px solid",
              borderColor: isEnhancing ? "#e6a800 #c8920a #c8920a #e6a800" : "#3d8b40 #2e6b31 #2e6b31 #3d8b40",
            }}
          />
          <span>OpenAlex</span>
        </div>
      </div>
    </div>
  );
}
