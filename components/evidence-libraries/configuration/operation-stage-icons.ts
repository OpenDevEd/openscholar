import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CheckCircle2,
  Clock3,
  Database,
  Hammer,
  HardDrive,
  HeartPulse,
  ListChecks,
  PackageOpen,
  RadioTower,
  Trash2,
} from "lucide-react";

export const OPERATION_STAGE_ICONS = {
  queued: Clock3,
  assembling: PackageOpen,
  validating: ListChecks,
  publishing: Hammer,
  activating: RadioTower,
  database: Database,
  storage: HardDrive,
  application: Boxes,
  deployment: Hammer,
  health_check: HeartPulse,
  coolify: Trash2,
  convex: Clock3,
  completed: CheckCircle2,
} satisfies Record<string, LucideIcon>;
