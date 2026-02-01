"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

interface JobStatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    label: string;
    positive: boolean;
  };
  loading?: boolean;
  className?: string;
  delay?: number;
}

export function JobStatCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
  className,
  delay = 0,
}: JobStatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.1, ease: "easeOut" }}
    >
      <Card
        className={cn(
          "overflow-hidden border-border/40 shadow-sm hover:shadow-md transition-shadow duration-300",
          className,
        )}
      >
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <div className="p-2 w-fit rounded-lg bg-primary/10 text-primary">
                <Icon className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {title}
                </h3>
                {loading ? (
                  <div className="h-8 w-24 bg-muted animate-pulse rounded" />
                ) : (
                  <div className="text-3xl font-bold tracking-tight text-foreground">
                    {value}
                  </div>
                )}
                {description && (
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    {description}
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
