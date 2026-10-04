"use client";

import { Ban, CirclePause, type AppIcon } from "@/components/icons";
import { StatusIcon, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";

const JOB_STATUS: Record<string, { tone: StatusTone; icon?: AppIcon }> = {
  pending: { tone: "neutral" },
  downloading_pdfs: { tone: "running" },
  extracting: { tone: "running" },
  completed: { tone: "success" },
  failed: { tone: "danger" },
  cancelled: { tone: "neutral", icon: Ban },
  paused: { tone: "neutral", icon: CirclePause },
  creditsExhausted: { tone: "warning" },
};

/** An extraction job's state as an icon, with its name for screen readers and on hover. */
export function JobStatusIcon({ status, label, className }: { status: string; label: string; className?: string }) {
  const { tone, icon } = JOB_STATUS[status] ?? { tone: "running" };
  return <StatusIcon tone={tone} icon={icon} label={label} data-job-status={status} className={className} />;
}
