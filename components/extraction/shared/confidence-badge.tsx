import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function getConfidenceColor(conf?: number) {
  if (!conf) return "bg-gray-500/10 text-gray-500 border-gray-200";
  if (conf >= 0.8)
    return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200";
  if (conf >= 0.5)
    return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200";
  return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200";
}

export function ConfidencePercentBadge({
  value,
  size = "md",
  className,
}: {
  value: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const percentage = Math.round(value * 100);

  return (
    <Badge
      variant="outline"
      className={cn(
        size === "sm" ? "text-2xs" : "text-xs",
        "font-medium",
        getConfidenceColor(value),
        className,
      )}
    >
      {percentage}%
    </Badge>
  );
}
