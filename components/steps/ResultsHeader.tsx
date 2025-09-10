"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { LucideIcon } from "lucide-react";

interface ResultsHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  count: number;
  countLabel: string;
  onRegenerate: () => void;
  colorScheme?: "blue" | "purple" | "green";
}

export function ResultsHeader({
  icon: Icon,
  title,
  subtitle,
  count,
  countLabel,
  onRegenerate,
  colorScheme = "blue"
}: ResultsHeaderProps) {
  const getColorClasses = () => {
    switch (colorScheme) {
      case "purple":
        return {
          container: "from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 border-purple-200/50 dark:border-purple-800/50",
          icon: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400",
          button: "text-purple-600 hover:text-purple-700 hover:bg-purple-100/50 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-900/20",
          badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800"
        };
      case "green":
        return {
          container: "from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200/50 dark:border-green-800/50",
          icon: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
          button: "text-green-600 hover:text-green-700 hover:bg-green-100/50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-900/20",
          badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800"
        };
      default: // blue
        return {
          container: "from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200/50 dark:border-blue-800/50",
          icon: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
          button: "text-blue-600 hover:text-blue-700 hover:bg-blue-100/50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20",
          badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800"
        };
    }
  };

  const colors = getColorClasses();

  return (
    <div className={`flex items-center justify-between p-4 rounded-xl bg-gradient-to-r ${colors.container} border`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          className={`${colors.button} gap-2 px-3 py-2 h-8 text-xs font-medium transition-all duration-200`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Regenerate
        </Button>
        <Badge variant="secondary" className={colors.badge}>
          {count} {countLabel}
        </Badge>
      </div>
    </div>
  );
}
