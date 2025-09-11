"use client";

import { useState, useEffect } from "react";
import { Progress } from "@/components/ui/progress";
import { LucideIcon } from "lucide-react";

interface LoadingStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  colorScheme?: "blue" | "purple" | "green";
  skeletonCount?: number;
  autoProgress?: boolean;
  progress?: number; // Custom progress value
}

export function LoadingState({
  icon: Icon,
  title,
  description,
  colorScheme = "blue",
  skeletonCount = 3,
  autoProgress = true,
  progress: customProgress
}: LoadingStateProps) {
  const [autoProgressValue, setAutoProgressValue] = useState(0);

  useEffect(() => {
    if (!autoProgress || customProgress !== undefined) return;

    const progressInterval = setInterval(() => {
      setAutoProgressValue(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    return () => clearInterval(progressInterval);
  }, [autoProgress, customProgress]);

  // Use custom progress if provided, otherwise use auto progress
  const displayProgress = customProgress !== undefined ? customProgress : autoProgressValue;

  const getColorClasses = () => {
    switch (colorScheme) {
      case "purple":
        return {
          container: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800",
          icon: "text-purple-600",
          text: "text-purple-600"
        };
      case "green":
        return {
          container: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
          icon: "text-green-600",
          text: "text-green-600"
        };
      default: // blue
        return {
          container: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
          icon: "text-blue-600",
          text: "text-blue-600"
        };
    }
  };

  const colors = getColorClasses();

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${colors.container}`}>
          <Icon className={`h-4 w-4 animate-pulse ${colors.icon}`} />
          <span className={`text-sm font-medium ${colors.text}`}>{title}</span>
        </div>
      </div>
      <div className="space-y-3">
        <Progress value={displayProgress} className="w-full" />
        <p className="text-center text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {/* Loading skeleton */}
      <div className="space-y-4">
        {Array.from({ length: skeletonCount }, (_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
