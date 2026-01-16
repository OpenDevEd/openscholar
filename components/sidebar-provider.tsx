"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/lib/hooks";

const SIDEBAR_STORAGE_KEY = "openscholar-sidebar-collapsed";
const SIDEBAR_WIDTH_EXPANDED = 280;
const SIDEBAR_WIDTH_COLLAPSED = 72;

interface SidebarContextValue {
  /** Whether the mobile sheet is open */
  isOpen: boolean;
  /** Whether the sidebar is collapsed (desktop only) */
  isCollapsed: boolean;
  /** Whether we're on mobile */
  isMobile: boolean;
  /** Expanded width in pixels */
  expandedWidth: number;
  /** Collapsed width in pixels */
  collapsedWidth: number;
  /** Current width based on collapsed state */
  currentWidth: number;
  /** Toggle the sidebar collapsed state (desktop) or open state (mobile) */
  toggle: () => void;
  /** Set the mobile sheet open state */
  setOpen: (open: boolean) => void;
  /** Set the collapsed state */
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

interface SidebarProviderProps {
  children: React.ReactNode;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
}

export function SidebarProvider({ 
  children, 
  defaultCollapsed = false 
}: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [isOpen, setOpen] = useState(false);
  const [isCollapsed, setCollapsedState] = useState(defaultCollapsed);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) {
      setCollapsedState(stored === "true");
    }
    setIsHydrated(true);
  }, []);

  // Persist collapsed state to localStorage
  const setCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedState(collapsed);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  }, []);

  // Toggle function - different behavior for mobile vs desktop
  const toggle = useCallback(() => {
    if (isMobile) {
      setOpen((prev) => !prev);
    } else {
      setCollapsed(!isCollapsed);
    }
  }, [isMobile, isCollapsed, setCollapsed]);

  // Keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  // Close mobile sheet when resizing to desktop
  useEffect(() => {
    if (!isMobile && isOpen) {
      setOpen(false);
    }
  }, [isMobile, isOpen]);

  // Auto-collapse on lg breakpoint (1024-1279px)
  useEffect(() => {
    if (!isHydrated) return;
    
    const handleResize = () => {
      const width = window.innerWidth;
      // Auto-collapse between 1024-1279px
      if (width >= 1024 && width < 1280) {
        setCollapsedState(true);
      }
    };

    // Only run on initial load, not on every resize
    // Users can manually toggle after initial load
    handleResize();
  }, [isHydrated]);

  const currentWidth = isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  const value: SidebarContextValue = {
    isOpen,
    isCollapsed,
    isMobile,
    expandedWidth: SIDEBAR_WIDTH_EXPANDED,
    collapsedWidth: SIDEBAR_WIDTH_COLLAPSED,
    currentWidth,
    toggle,
    setOpen,
    setCollapsed,
  };

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
