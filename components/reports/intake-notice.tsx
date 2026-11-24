"use client";

// What the Publish page says while new reports are closed (lib/reports/intake.ts): above the list, on a draft, and as
// the reason beside a Next or Activate that waits. MOCK (mock/new-report-limits).

import { createContext, useContext } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Ban, CalendarClock, FileText, Hourglass } from "@/components/icons";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { useIntakeState, type IntakeState } from "@/lib/reports/intake";
import { cn } from "@/lib/utils";

type Closed = Exclude<IntakeState, { open: true }>;

const useWhen = () => {
  const format = useFormatter();
  return (at: number) => format.dateTime(at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Why a new report can't start or a draft go on now, in a few words for beside the button; null while they can. */
export function useIntakeShut(): string | null {
  const t = useTranslations("publishReports.flow.intake.shut");
  const when = useWhen();
  const state = useIntakeState();
  if (state.open) return null;
  if (state.why === "off") return t("off");
  if (state.why === "notYet") return t("notYet", { date: when(state.at) });
  if (state.why === "full" && state.reopensAt !== null) return t("next", { date: when(state.reopensAt) });
  return t("over");
}

/** The reason a draft's Next waits, given to every Next on the page (NextButton). Null while a draft can go on. */
export const IntakeShut = createContext<string | null>(null);
export const useShutNext = () => useContext(IntakeShut);

/** The title and words for a closed state, and the date a chip gives, if any. */
export function useIntakeWords(state: Closed) {
  const t = useTranslations("publishReports.flow.intake");
  const when = useWhen();
  if (state.why === "off") return { icon: Ban, title: t("off.title"), body: t("off.body"), chip: null };
  if (state.why === "notYet") return { icon: CalendarClock, title: t("notYet.title"), body: t("notYet.body"), chip: t("opens", { date: when(state.at) }) };
  if (state.why === "ended") return { icon: Hourglass, title: t("over.title"), body: t("ended.body"), chip: t("closed", { date: when(state.at) }) };
  return { icon: Hourglass, title: t("over.title"), body: t(state.reopensAt === null ? "full.last" : "full.body"), chip: state.reopensAt === null ? null : t("next", { date: when(state.reopensAt) }) };
}

/** The notice above the list or a draft: what is closed, why, and when it opens again. */
export function IntakeNotice({ className }: { className?: string }) {
  const state = useIntakeState();
  if (state.open) return null;
  return <ClosedNotice state={state} className={className} />;
}

function ClosedNotice({ state, className }: { state: Closed; className?: string }) {
  const { icon: Icon, title, body, chip } = useIntakeWords(state);
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-inset px-4 py-3", className)}>
      <span className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 ink-warning" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{body}</span>
        </span>
      </span>
      {chip ? (
        <StatusChip tone="neutral" icon={CalendarClock} className="shrink-0">
          {chip}
        </StatusChip>
      ) : null}
    </div>
  );
}

/** The Publish page's new report while new reports are closed: why, when they open again, and the way to the list. */
export function IntakeClosedPage({ hasReports, onReports }: { hasReports: boolean; onReports: () => void }) {
  const state = useIntakeState();
  const t = useTranslations("publishReports.flow");
  if (state.open) return null;
  return <ClosedPage state={state} hasReports={hasReports} onReports={onReports} yourReports={t("yourReports")} />;
}

function ClosedPage({ state, hasReports, onReports, yourReports }: { state: Closed; hasReports: boolean; onReports: () => void; yourReports: string }) {
  const { icon, title, body, chip } = useIntakeWords(state);
  return (
    <ListEmpty
      icon={icon}
      description={body}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {chip ? (
            <StatusChip tone="neutral" icon={CalendarClock}>
              {chip}
            </StatusChip>
          ) : null}
          {hasReports ? (
            <Button size="sm" variant="outline" onClick={onReports}>
              <FileText /> {yourReports}
            </Button>
          ) : null}
        </div>
      }
    >
      {title}
    </ListEmpty>
  );
}
