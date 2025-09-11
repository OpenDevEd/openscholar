"use client";

import { LucideIcon, Lightbulb, HelpCircle } from "lucide-react";
import { ReactNode } from "react";

interface InfoSectionProps {
  title: string;
  content: ReactNode;
  icon?: LucideIcon;
  variant?: "tips" | "info" | "help";
}

export function InfoSection({
  title,
  content,
  icon: Icon = Lightbulb,
  variant = "info"
}: InfoSectionProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case "tips":
        return {
          container: "from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-blue-100/50 dark:border-blue-900/20",
          icon: "text-blue-600"
        };
      case "help":
        return {
          container: "from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-100/50 dark:border-amber-900/20",
          icon: "text-amber-600"
        };
      default: // info
        return {
          container: "from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-blue-100/50 dark:border-blue-900/20",
          icon: "text-blue-600"
        };
    }
  };

  const classes = getVariantClasses();

  return (
    <div className={`bg-gradient-to-r ${classes.container} rounded-lg p-4 border`}>
      <h4 className="font-semibold mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${classes.icon}`} />
        {title}
      </h4>
      <div className="text-sm text-muted-foreground leading-relaxed">
        {content}
      </div>
    </div>
  );
}
