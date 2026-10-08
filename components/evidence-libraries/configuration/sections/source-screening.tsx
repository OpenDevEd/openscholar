"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type ScreeningVerdict = { key: string; label: string; count: number | null; kept: boolean };

/**
 * What screening found in a source and which verdicts stay in the library: one row per verdict, with its share
 * of the source's records as a bar, its count, and a switch that keeps it in or out.
 */
export function SourceScreening({
  subject,
  subjectPlaceholder,
  onSubjectChange,
  verdicts,
  onKeptChange,
}: {
  subject: string;
  subjectPlaceholder: string;
  onSubjectChange: (subject: string) => void;
  verdicts: ScreeningVerdict[];
  onKeptChange: (key: string, kept: boolean) => void;
}) {
  const screened = verdicts.every((verdict) => verdict.count !== null);
  const total = verdicts.reduce((sum, verdict) => sum + (verdict.count ?? 0), 0);
  const kept = verdicts.reduce((sum, verdict) => sum + (verdict.kept ? verdict.count ?? 0 : 0), 0);
  return (
    <div className="space-y-3 rounded-lg border border-border-subtle bg-inset p-3">
      <label className="grid gap-1.5 text-xs">
        <span className="text-muted-foreground">Screen for</span>
        <Input
          className="bg-background"
          value={subject}
          placeholder={subjectPlaceholder}
          onChange={(event) => onSubjectChange(event.target.value)}
        />
      </label>
      <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_8ch_auto] items-center gap-x-3 gap-y-2 text-xs">
        <span className="col-span-3" />
        <span className="text-muted-foreground">In library</span>
        {verdicts.map((verdict) => (
          <div key={verdict.key} className="contents">
            <span className={cn("truncate", !verdict.kept && "text-muted-foreground")}>{verdict.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              {verdict.count ? (
                <span
                  className={cn("block h-full min-w-0.5 rounded-full", verdict.kept ? "bg-primary" : "bg-muted-foreground/45")}
                  style={{ width: `${(100 * verdict.count) / total}%` }}
                />
              ) : null}
            </span>
            <span className={cn("text-right tabular-nums", !verdict.kept && "text-muted-foreground")}>
              {verdict.count === null ? null : verdict.count.toLocaleString()}
            </span>
            <Switch
              className="justify-self-end"
              checked={verdict.kept}
              aria-label={`Keep records Jev finds ${verdict.label.toLowerCase()}`}
              onCheckedChange={(checked) => onKeptChange(verdict.key, checked)}
            />
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3 text-xs">
        {screened ? (
          <>
            <span>
              <span className="text-base font-semibold tabular-nums">{kept.toLocaleString()}</span>{" "}
              <span className="text-muted-foreground">in the library</span>
            </span>
            <span className="text-muted-foreground">
              <span className="tabular-nums text-foreground">{(total - kept).toLocaleString()}</span> kept out
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Screening starts with the next import.</span>
        )}
      </div>
    </div>
  );
}
