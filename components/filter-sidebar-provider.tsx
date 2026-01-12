"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/lib/hooks";

const FILTER_SIDEBAR_STORAGE_KEY = "openscholar-filter-sidebar-collapsed";
const FILTER_SIDEBAR_WIDTH_EXPANDED = 320;
const FILTER_SIDEBAR_WIDTH_COLLAPSED = 48;

interface FilterSidebarContextValue {
  /** Whether the filter sidebar is collapsed */
  isCollapsed: boolean;
  /** Whether we're on mobile */
  isMobile: boolean;
  /** Expanded width in pixels */
  expandedWidth: number;
  /** Collapsed width in pixels */
  collapsedWidth: number;
  /** Current width based on collapsed state */
  currentWidth: number;
  /** Toggle the collapsed state */
  toggle: () => void;
  /** Set the collapsed state */
  setCollapsed: (collapsed: boolean) => void;
}

const FilterSidebarContext = createContext<FilterSidebarContextValue | undefined>(undefined);

interface FilterSidebarProviderProps {
  children: React.ReactNode;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
}

export function FilterSidebarProvider({ 
  children, 
  defaultCollapsed = false 
}: FilterSidebarProviderProps) {
  const isMobile = useIsMobile();
  const [isCollapsed, setCollapsedState] = useState(defaultCollapsed);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(FILTER_SIDEBAR_STORAGE_KEY);
    if (stored !== null) {
      setCollapsedState(stored === "true");
    }
    setIsHydrated(true);
  }, []);

  // Persist collapsed state to localStorage
  const setCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedState(collapsed);
    localStorage.setItem(FILTER_SIDEBAR_STORAGE_KEY, String(collapsed));
  }, []);

  // Toggle function
  const toggle = useCallback(() => {
    setCollapsed(!isCollapsed);
  }, [isCollapsed, setCollapsed]);

  // Keyboard shortcut: Ctrl+Shift+F to toggle filter sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  const currentWidth = isCollapsed ? FILTER_SIDEBAR_WIDTH_COLLAPSED : FILTER_SIDEBAR_WIDTH_EXPANDED;

  const value: FilterSidebarContextValue = {
    isCollapsed,
    isMobile,
    expandedWidth: FILTER_SIDEBAR_WIDTH_EXPANDED,
    collapsedWidth: FILTER_SIDEBAR_WIDTH_COLLAPSED,
    currentWidth,
    toggle,
    setCollapsed,
  };

  return (
    <FilterSidebarContext.Provider value={value}>
      {children}
    </FilterSidebarContext.Provider>
  );
}

export function useFilterSidebar() {
  const context = useContext(FilterSidebarContext);
  if (!context) {
    throw new Error("useFilterSidebar must be used within a FilterSidebarProvider");
  }
  return context;
}

export function useFilterSidebarOptional() {
  return useContext(FilterSidebarContext);
}
