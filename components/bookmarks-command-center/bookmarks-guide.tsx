"use client";
"use no memo"; // try/finally in handlers

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
import { HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

export function BookmarksGuide() {
  const tb = useTranslations("bookmarksPage");
  const [isOpen, setIsOpen] = useState(false);

  const code = (chunks: React.ReactNode) => (
    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{chunks}</code>
  );

  const tips = [
    {
      title: tb("usingBookmarksInSearch"),
      description: tb.rich("guideTip1Description", { code }),
    },
    {
      title: tb("autoExpansion"),
      description: tb.rich("guideTip2Description", { code }),
    },
    {
      title: tb("namingRules"),
      description: tb("namingRulesDescription"),
    },
    {
      title: tb("missingBookmarks"),
      description: tb("missingBookmarksDescription"),
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
            {tb("howToUseBookmarks")}
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
