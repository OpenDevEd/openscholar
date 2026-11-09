"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Mail, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AutoHeight } from "@/components/ui/auto-height";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { EmptyList } from "../configuration/fields";
import { useWithPage } from "../configuration/preloads";
import { APPLICATIONS_PAGE } from "@/lib/evidence-libraries/applications";

const REASONS = ["topic", "moreAbout", "notNow"] as const;
/** Longest reason a decline carries (convex/lib/queryBounds.ts). */
const REASON_MAX = 500;
type Applicant = FunctionReturnType<typeof api.evidenceLibraries.applications.waiting>["page"][number];

/** The people asking to join, for its owners and editors: each with their message, to accept as a Creator or decline. */
export function ApplicationsList({ libraryId, search, owner, closed, notify }: {
  libraryId: Id<"evidenceLibraries">;
  search: string;
  owner: boolean;
  /** Its owners turned applications off: what waits stays to answer. */
  closed: boolean;
  notify: (text: string) => void;
}) {
  const t = useTranslations("communityApplications");
  const workspaceId = useWorkspace();
  const live = useProtectedPaginatedQuery(api.evidenceLibraries.applications.waiting, workspaceId ? { workspaceId, libraryId } : "skip", { initialNumItems: APPLICATIONS_PAGE });
  // Until the live list arrives, the first page the settings page's server read with it.
  const first = useWithPage<typeof api.evidenceLibraries.applications.waiting>("applications", undefined);
  // A read skipped until the workspace is known says it has loaded, with nothing: the server's page stands until it's live.
  const loaded = Boolean(workspaceId) && live.hasLoadedFirstPage;
  const rows = loaded ? live.results : first?.page;
  const more = loaded ? live.status === "CanLoadMore" : first?.isDone === false;
  const needle = search.toLowerCase();
  const shown = (rows ?? []).filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle));
  return (
    <>
      {shown.length ? (
        <ul className="divide-y divide-border-subtle">
          {shown.map((applicant) => <ApplicationRow key={applicant.applicationId} applicant={applicant} notify={notify} />)}
        </ul>
      ) : (
        <EmptyList>
          {rows === undefined ? null : search ? t("noMatchingApplications") : closed ? (owner ? t.rich("offForOwner", { link: (chunks) => <a href="?section=listing" className="underline underline-offset-2">{chunks}</a> }) : t("offForEditor")) : t("noApplications")}
        </EmptyList>
      )}
      {/* While searching too: the one searched for may be on a page not read yet. */}
      {more ? (
        <div className="border-t border-border-subtle px-4 py-3">
          <Button variant="ghost" size="sm" disabled={!loaded || live.status === "LoadingMore"} onClick={() => live.loadMore(APPLICATIONS_PAGE)}>{t("showMore")}</Button>
        </div>
      ) : null}
    </>
  );
}

function ApplicationRow({ applicant, notify }: { applicant: Applicant; notify: (text: string) => void }) {
  const t = useTranslations("communityApplications");
  // The browser's clock: the page's own is the server's, from when it drew the page, and an application sent since reads as in the future.
  const now = Date.now();
  const format = useFormatter();
  const accept = useWorkspaceMutation(api.evidenceLibraries.applications.accept);
  const decline = useWorkspaceMutation(api.evidenceLibraries.applications.decline);
  const [busy, setBusy] = useState(false);
  const answer = async (change: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await change(); notify(done); } catch (error) { notify(getErrorMessage(error, t("couldNotChange"))); } finally { setBusy(false); }
  };
  const [unfolded, setUnfolded] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [note, setNote] = useState("");

  // Folded to three lines; Show all only when the fold cuts something off, measured as it's drawn.
  const [long, setLong] = useState(false);
  const measure = (element: HTMLParagraphElement | null) => { if (element && !unfolded) setLong(element.scrollHeight > element.clientHeight + 1); };
  const messageId = `application-${applicant.applicationId}`;
  return (
    <li className="fade-enter px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <IdentityAvatar name={applicant.name} imageUrl={applicant.imageUrl} className="size-9" />
        <div className="min-w-0 flex-[1_1_10rem]">
          <p className="truncate text-sm font-medium">{applicant.name}</p>
          <p className="truncate text-xs text-muted-foreground">{applicant.email}</p>
        </div>
        <span className="shrink-0 text-xs text-subtle-foreground">{t("appliedWhen", { when: format.relativeTime(applicant.createdAt, now) })}</span>
      </div>
      {/* Their message under their name, lined up with it; a long one opens on tap, on a phone as on a desktop. */}
      <div className="mt-3 sm:ms-12">
        <p id={messageId} ref={measure} className={cn("whitespace-pre-line rounded-lg bg-inset px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]", !unfolded && "line-clamp-3")}>{applicant.message}</p>
        {long ? (
          <Button variant="link" size="sm" className="h-7 px-0 text-xs" aria-expanded={unfolded} aria-controls={messageId} onClick={() => setUnfolded(!unfolded)}>
            {unfolded ? t("showLess") : t("showAll")}
          </Button>
        ) : null}
        <AutoHeight>
          {declining ? (
            <form
              className="mt-3 space-y-3 rounded-lg border border-border-subtle p-3"
              onSubmit={(event) => {
                event.preventDefault();
                // The ready-made reason goes by its key, so the applicant reads it in their own language.
                const why = note.trim();
                void answer(() => decline({ applicationId: applicant.applicationId, ...(reason ? { preset: reason } : {}), ...(why ? { reason: why } : {}) }), t("declinedNotice", { name: applicant.name }));
              }}
            >
              <div>
                <p id={`${messageId}-why`} className="text-xs font-medium">{t("whyDecline")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-labelledby={`${messageId}-why`}>
                  {REASONS.map((key) => (
                    <Button key={key} type="button" size="sm" variant="outline" aria-pressed={reason === key} onClick={() => setReason(reason === key ? null : key)}
                      className={cn("h-7 rounded-full px-2.5 text-xs font-normal", reason === key && "border-primary/40 bg-primary/5 text-foreground")}>
                      {reason === key ? <Check className="size-3.5" /> : null}{t(`reasons.${key}`)}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Textarea aria-label={t("addANote")} placeholder={t("addANote")} value={note} onChange={(event) => setNote(event.target.value)} maxLength={REASON_MAX} rows={2} className="h-16 resize-none field-sizing-fixed [overflow-wrap:anywhere]" />
                {/* How much fits, as the application's own message shows it. */}
                <p aria-hidden dir="ltr" className={cn("mt-1 text-end text-xs tabular-nums", note.length >= REASON_MAX ? "ink-warning" : "text-subtle-foreground")}>{note.length} / {REASON_MAX}</p>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Mail className="size-3.5 shrink-0" />{t("theyGetAnEmail")}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)}>{t("cancel")}</Button>
                <Button type="submit" size="sm" variant="destructive" disabled={busy} aria-busy={busy}>{t("declineAndEmail")}</Button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} aria-busy={busy} onClick={() => void answer(() => accept({ applicationId: applicant.applicationId }), t("acceptedNotice", { name: applicant.name }))}>
                <Check />{t("acceptAsCreator")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeclining(true)}><X />{t("decline")}</Button>
            </div>
          )}
        </AutoHeight>
      </div>
    </li>
  );
}
