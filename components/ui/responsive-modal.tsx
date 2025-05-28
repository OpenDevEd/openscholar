"use client";

import * as React from "react";
import { useMediaQuery } from "@/lib/hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { X, Search, Hash, Filter, Calendar, SortAsc } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title: string;
  headerActions?: React.ReactNode;
  className?: string;
  // Additional metadata for the header
  searchQuery?: string;
  searchField?: string;
  resultCount?: number;
  dateRange?: string;
  sortBy?: string;
}

export function ResponsiveModal({
  open,
  onOpenChange,
  children,
  title,
  headerActions,
  className,
  searchQuery,
  searchField,
  resultCount,
  dateRange,
  sortBy,
}: ResponsiveModalProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const HeaderContent = () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg md:text-xl font-semibold leading-tight break-words">
            Search Results
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 md:pr-12">
          {headerActions}
          {!isDesktop && (
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
          )}
        </div>
      </div>
      
      {searchQuery && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-3">
          <Search className="h-4 w-4 flex-shrink-0" />
          <span className="break-all font-medium">{searchQuery}</span>
        </div>
      )}
      
      <div className="flex flex-wrap gap-2">
        {searchField && (
          <span className="inline-flex items-center gap-1 rounded-full border-transparent bg-secondary text-secondary-foreground px-2.5 py-0.5 text-xs font-semibold">
            <Filter className="h-3 w-3" />
            {searchField.split('_').map(word => 
              word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ')}
          </span>
        )}
        
        {resultCount !== undefined && (
          <span className="inline-flex items-center gap-1 rounded-full border text-foreground px-2.5 py-0.5 text-xs font-semibold">
            <Hash className="h-3 w-3" />
            {resultCount.toLocaleString()} results
          </span>
        )}
        
        {dateRange && (
          <span className="inline-flex items-center gap-1 rounded-full border text-foreground px-2.5 py-0.5 text-xs font-semibold">
            <Calendar className="h-3 w-3" />
            {dateRange}
          </span>
        )}
        
        {sortBy && (
          <span className="inline-flex items-center gap-1 rounded-full border text-foreground px-2.5 py-0.5 text-xs font-semibold">
            <SortAsc className="h-3 w-3" />
            {sortBy}
          </span>
        )}
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("max-w-[90%] md:max-w-4xl lg:max-w-6xl w-full overflow-hidden", className)}>
          <DialogHeader className="pb-4">
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <HeaderContent />
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={cn(
        "h-[95vh] flex flex-col",
        "data-[vaul-drawer-direction=bottom]:max-h-[95vh] data-[vaul-drawer-direction=bottom]:mt-[5vh]"
      )}>
        <DrawerHeader className="flex-shrink-0 p-4 pb-2">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <HeaderContent />
        </DrawerHeader>
        <div className="px-4 pb-4 flex-1 overflow-hidden">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
} 