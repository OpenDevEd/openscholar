"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "./index";

export function BookmarksGuide() {
  const [isOpen, setIsOpen] = useState(false);

  const tips = [
    {
      title: "Using bookmarks in search",
      description: (
        <>
          Type your bookmark name followed by <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">...</code> in the search box.
          For example: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">(ml...)</code>
        </>
      ),
    },
    {
      title: "Auto-expansion",
      description: (
        <>
          Your bookmark will automatically expand to the full search terms.
          Example: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">ml...</code> becomes{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">AI OR ML OR "artificial intelligence"</code>
        </>
      ),
    },
    {
      title: "Naming rules",
      description: "Bookmarks are case-sensitive and can only contain letters, numbers, and dashes. No spaces allowed.",
    },
    {
      title: "Missing bookmarks",
      description: "You'll see a warning if you use a bookmark that doesn't exist. The original text will be kept unchanged.",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...subtleSpring, delay: 0.2 }}
      className={cn(
        "mt-6",
        "rounded-xl",
        "border border-border/40",
        "bg-muted/20"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full px-4 py-3",
          "flex items-center justify-between gap-3",
          "text-left",
          "hover:bg-muted/30 transition-colors",
          "rounded-xl",
          isOpen && "rounded-b-none border-b border-border/30"
        )}
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            How to use bookmarks
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-4 space-y-4">
              {tips.map((tip, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-1">
                      {tip.title}
                    </h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {tip.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
