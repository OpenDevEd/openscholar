import { BookOpen, Globe, PlanIcon, type AppIcon } from "@/components/icons";

const PLAN_ICONS: Record<string, AppIcon> = { free: BookOpen, southern: Globe };

/** The icon for a plan wherever it is named. Plans added later in Autumn get the plain plan ticket. */
export const planIcon = (planId: string | null | undefined): AppIcon => (planId && PLAN_ICONS[planId]) || PlanIcon;
