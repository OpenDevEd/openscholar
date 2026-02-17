export type ChangeType =
  | "upgraded_immediately"
  | "downgrade_scheduled"
  | "pending_change_cleared"
  | "no_change";

type PhaseItemLike = {
  price?: string | { id?: string | null } | null;
  quantity?: number | null;
};

type PhaseLike = {
  start_date?: number | null;
  end_date?: number | null;
  items?: PhaseItemLike[] | null;
};

type CurrentPhaseLike = {
  start_date?: number | null;
  end_date?: number | null;
};

export type ScheduleLike = {
  status?: string | null;
  current_phase?: CurrentPhaseLike | null;
  phases?: PhaseLike[] | null;
};

export function getScheduleId(
  schedule: string | { id?: string | null } | null | undefined,
): string | null {
  if (!schedule) return null;
  if (typeof schedule === "string") return schedule;
  return schedule.id ?? null;
}

export function isReleasableScheduleStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "not_started";
}

export function getPhasePriceId(phase: PhaseLike | null | undefined): string | null {
  if (!phase?.items?.length) return null;
  const first = phase.items[0];
  if (!first?.price) return null;
  if (typeof first.price === "string") return first.price;
  return first.price.id ?? null;
}

function normalizeQuantity(quantity: number | null | undefined): number {
  if (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0) {
    return quantity;
  }
  return 1;
}

export function resolveCurrentPhaseBounds(args: {
  schedule: ScheduleLike | null | undefined;
  fallbackStart: number;
  fallbackEnd: number;
}): { startDate: number; endDate: number } {
  const startDate = args.schedule?.current_phase?.start_date ?? args.fallbackStart;
  const endDate = args.schedule?.current_phase?.end_date ?? args.fallbackEnd;

  if (!startDate || !endDate || endDate <= startDate) {
    throw new Error("Unable to determine valid schedule phase boundaries");
  }

  return { startDate, endDate };
}

export function findPendingScheduleChange(args: {
  schedule: ScheduleLike | null | undefined;
  currentPriceId: string;
}): {
  hasPendingChange: boolean;
  targetPriceId?: string;
  effectiveDate?: number;
} {
  const phases = args.schedule?.phases ?? [];
  const currentPhaseEnd = args.schedule?.current_phase?.end_date ?? null;

  for (const phase of phases) {
    const priceId = getPhasePriceId(phase);
    if (!priceId || priceId === args.currentPriceId) continue;

    const phaseStart = phase.start_date ?? undefined;

    // If Stripe has a current phase boundary, only treat later phases as pending.
    if (currentPhaseEnd !== null) {
      if (typeof phaseStart === "number" && phaseStart >= currentPhaseEnd) {
        return {
          hasPendingChange: true,
          targetPriceId: priceId,
          effectiveDate: phaseStart,
        };
      }
      continue;
    }

    return {
      hasPendingChange: true,
      targetPriceId: priceId,
      effectiveDate: phaseStart,
    };
  }

  return { hasPendingChange: false };
}

export function buildDowngradeSchedulePhases(args: {
  currentPhaseStart: number;
  currentPhaseEnd: number;
  currentPriceId: string;
  currentQuantity: number | null | undefined;
  targetPriceId: string;
  targetQuantity?: number | null;
}): Array<{
  start_date: number;
  end_date?: number;
  items: Array<{
    price: string;
    quantity: number;
  }>;
}> {
  if (!args.currentPhaseStart || !args.currentPhaseEnd) {
    throw new Error("Schedule phase boundaries are required for downgrade planning");
  }
  if (args.currentPhaseEnd <= args.currentPhaseStart) {
    throw new Error("Invalid schedule phase boundaries");
  }

  const currentQuantity = normalizeQuantity(args.currentQuantity);
  const targetQuantity = normalizeQuantity(args.targetQuantity ?? args.currentQuantity);

  return [
    {
      start_date: args.currentPhaseStart,
      end_date: args.currentPhaseEnd,
      items: [
        {
          price: args.currentPriceId,
          quantity: currentQuantity,
        },
      ],
    },
    {
      start_date: args.currentPhaseEnd,
      items: [
        {
          price: args.targetPriceId,
          quantity: targetQuantity,
        },
      ],
    },
  ];
}

export function determineChangeType(args: {
  currentTier: number;
  targetTier: number;
  hasPendingScheduledChange: boolean;
}): ChangeType {
  if (args.targetTier > args.currentTier) {
    return "upgraded_immediately";
  }
  if (args.targetTier < args.currentTier) {
    return "downgrade_scheduled";
  }
  if (args.hasPendingScheduledChange) {
    return "pending_change_cleared";
  }
  return "no_change";
}

export function shouldReleaseScheduleForChange(args: {
  changeType: ChangeType;
  scheduleStatus: string | null | undefined;
}): boolean {
  if (!isReleasableScheduleStatus(args.scheduleStatus)) {
    return false;
  }

  return (
    args.changeType === "upgraded_immediately" ||
    args.changeType === "pending_change_cleared"
  );
}
