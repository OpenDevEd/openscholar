"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useKeywordExpansionStore } from "@/lib/store";
import { toast } from "sonner";
import { subtleSpring } from "@/lib/animation-config";

export function BookmarksAddForm() {
  const [name, setName] = useState("");
  const [expansion, setExpansion] = useState("");
  const { keywords, addKeyword } = useKeywordExpansionStore();

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return "Bookmark name cannot be empty";
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return "Bookmark name can only contain letters, numbers, and dashes";
    if (keyword.includes(' ')) return "Bookmark name cannot contain spaces";
    return null;
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    const trimmedExpansion = expansion.trim();

    const validationError = validateKeyword(trimmedName);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!trimmedExpansion) {
      toast.error("Expansion text cannot be empty");
      return;
    }

    if (keywords[trimmedName]) {
      toast.error(`Bookmark "${trimmedName}" already exists`);
      return;
    }

    addKeyword(trimmedName, trimmedExpansion);
    setName("");
    setExpansion("");
    toast.success(`Bookmark "${trimmedName}" added successfully`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...subtleSpring, delay: 0.1 }}
      className={cn(
        "px-4 md:px-6 py-4",
        "border-b border-border/40",
        "bg-muted/20"
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name input */}
        <div className="space-y-1.5">
          <Label htmlFor="bookmark-name" className="text-xs text-muted-foreground">
            Bookmark Name
          </Label>
          <Input
            id="bookmark-name"
            placeholder="e.g., ml, ai-terms, my-search"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              "h-10",
              "bg-background/60",
              "border-border/50",
              "placeholder:text-muted-foreground/60"
            )}
          />
          <p className="text-xs text-muted-foreground">
            Letters, numbers, and dashes only
          </p>
        </div>

        {/* Expansion input */}
        <div className="space-y-1.5">
          <Label htmlFor="bookmark-expansion" className="text-xs text-muted-foreground">
            Expands To
          </Label>
          <Input
            id="bookmark-expansion"
            placeholder={`e.g., AI OR ML OR "artificial intelligence"`}
            value={expansion}
            onChange={(e) => setExpansion(e.target.value)}
            className={cn(
              "h-10",
              "bg-background/60",
              "border-border/50",
              "placeholder:text-muted-foreground/60"
            )}
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">name...</code> in search to expand
          </p>
        </div>
      </div>

      {/* Add button - full width below on mobile, right-aligned on desktop */}
      <div className="mt-4 flex justify-end">
        <Button
          onClick={handleAdd}
          disabled={!name.trim() || !expansion.trim()}
          className="w-full md:w-auto gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add Bookmark
        </Button>
      </div>
    </motion.div>
  );
}
