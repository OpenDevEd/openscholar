"use client";

import { Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CreditBalanceCardProps {
  freeBalance: number;
  paidBalance: number;
  totalBalance: number;
  creditsPerMonth?: number;
  freeCreditCap?: number;
  className?: string;
}

export function CreditBalanceCard({
  freeBalance,
  paidBalance,
  totalBalance,
  creditsPerMonth = 0,
  freeCreditCap = 10000,
  className,
}: CreditBalanceCardProps) {
  // Calculate free credit usage percentage (for progress bar)
  const freeCreditsPercentage = creditsPerMonth > 0 
    ? Math.min((freeBalance / creditsPerMonth) * 100, 100)
    : 0;

  // Calculate how close to the cap
  const freeCapPercentage = (freeBalance / freeCreditCap) * 100;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
        <Zap className="w-4 h-4" />
        <span>Credits</span>
      </div>

      <div className="space-y-6 rounded-xl border border-border/50 bg-muted/30 p-5">
        {/* Total Balance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Total Balance</span>
            <span className="text-2xl font-bold font-mono">
              {totalBalance.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Free Credits */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium flex items-center gap-2">
              Free Credits
              {creditsPerMonth > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({creditsPerMonth.toLocaleString()}/month)
                </span>
              )}
            </span>
            <span className="text-muted-foreground font-mono">
              {freeBalance.toLocaleString()} / {freeCreditCap.toLocaleString()}
            </span>
          </div>
          <Progress 
            value={freeCapPercentage} 
            className="h-2 bg-background"
          />
          {freeCapPercentage >= 100 && (
            <p className="text-xs text-amber-600">
              Free credit cap reached. Purchase additional credits for unlimited balance.
            </p>
          )}
        </div>

        {/* Paid Credits */}
        {paidBalance > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Purchased Credits</span>
              <span className="text-muted-foreground font-mono">
                {paidBalance.toLocaleString()}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              No expiration or cap
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground">
          Credits are consumed in this order: free first, then purchased.
        </div>
      </div>
    </div>
  );
}
