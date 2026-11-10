"use client";

// Settings > Admin > Publishing (plans/publish-reports): the reports reviewers work on, and the series' settings.

import { useMutation } from "convex/react";
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AdminPublishingSettings, SETTINGS_PLACE } from "@/components/reports/admin-settings";
import { Submissions } from "@/components/reports/admin-submissions";
import { DetailsStep } from "@/components/reports/details-step";
import { Enter, Segmented } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { ChevronLeft, FileText, PublishIcon } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { stepBack, withoutKeys } from "@/lib/url-state/step-back";

/**
 * Where a reviewer is on the page, in its address: the view, the report whose dialog is open, and its details open
 * to edit. Each move there is a step in the browser's history, so Back closes what was opened last and a link or a
 * reload lands on the same thing.
 */
const PLACE = {
  view: parseAsStringLiteral(["submissions", "settings"] as const).withDefault("submissions"),
  report: parseAsString,
  edit: parseAsBoolean.withDefault(false),
  ...SETTINGS_PLACE,
};

export function AdminPublishing() {
  const t = useTranslations("publishReports.admin");
  const [nav, setNav] = useQueryStates(PLACE);
  // Another screen opens at its top; a dialog opens over the page where it is. Closing with the screen's own
  // button is the step back when that step is there (lib/url-state/step-back.ts), so Back never reopens what was
  // just closed. What a link or a reload opened has no step behind it, so it closes in place.
  const go = (next: Parameters<typeof setNav>[0], scroll = true) => void setNav(next, { history: "push", scroll });
  const up = (...closed: Array<keyof typeof PLACE>) => {
    if (!stepBack(withoutKeys(closed))) void setNav(Object.fromEntries(closed.map((key) => [key, null])));
  };
  const { data: waiting } = useProtectedQuery(api.reports.review.page, { page: 1, show: "review" });
  const { data: editing } = useProtectedQuery(api.reports.review.get, nav.edit && nav.report ? { key: nav.report } : "skip");
  const editDetails = useMutation(api.reports.review.editDetails);

  // A reviewer edits a checked report's details in the form its author fills in. It is a screen of its own, with
  // the way back to the report at its head and nothing of the list around it.
  if (nav.edit && nav.report) {
    if (editing === undefined) return <Enter ready={false}>{null}</Enter>;
    const editable = editing?.metadata && editing.step === "done" && !editing.correction ? editing : null;
    if (editable) {
      const live = editable.status === "live";
      return (
        <Enter ready>
          <div className="space-y-5">
            <Button variant="ghost" size="sm" className="-ms-2.5 text-muted-foreground" onClick={() => up("edit")}>
              <ChevronLeft /> {t("backToReport")}
            </Button>
            <DetailsStep
              key={editable.key}
              initial={editable.metadata!}
              version={editable.updatedAt}
              words={{
                title: t("editTitle"),
                intro: t(live ? "editIntroLive" : "editIntroNotLive", { key: editable.key }),
                action: t("saveDetails"),
              }}
              onRun={async (metadata, seenAt) => {
                try {
                  await editDetails({ key: editable.key, seenAt: seenAt!, metadata });
                  toast.success(t(live ? "savedLive" : "saved"));
                  // Back to the report's dialog, which now shows the edit.
                  up("edit");
                } catch (error) {
                  toast.error(getErrorMessage(error, t("saveFailed")));
                }
              }}
              onCancel={() => up("edit")}
            />
          </div>
        </Enter>
      );
    }
  }

  return (
    <div className="space-y-6">
      <Segmented
        label={t("publishing")}
        value={nav.view}
        // The other view opens with nothing left open from this one.
        onChange={(view) => go({ view, report: null, edit: null, check: null, agreement: null })}
        options={[
          { id: "submissions", label: t("submissions"), icon: FileText, detail: waiting?.total ? <span className="rounded-full bg-primary/15 px-1.5 text-2xs tabular-nums text-primary">{waiting.total}</span> : undefined },
          { id: "settings", label: t("settings"), icon: PublishIcon },
        ]}
        size="md"
      />
      {nav.view === "submissions" ? <Submissions open={nav.report} onOpen={(report) => (report ? go({ report, edit: null }, false) : up("report", "edit"))} onEdit={() => go({ edit: true })} /> : <AdminPublishingSettings />}
    </div>
  );
}
