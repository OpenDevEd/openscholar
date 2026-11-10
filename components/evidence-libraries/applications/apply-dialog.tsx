"use client";

import { createContext, useContext, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { parseAsString, useQueryState } from "nuqs";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AddedPapersIcon, Check, Clock3, ExternalLink, Lock, Mail, PenLine, ReviewQueueIcon, Send, XCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AutoHeight } from "@/components/ui/auto-height";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkspaceTile } from "@/components/workspaces/parts";
import { FadeImage } from "@/components/ui/fade-image";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { APPLY_PARAM } from "@/lib/evidence-libraries/applications";
import { cn } from "@/lib/utils";

/** Longest message an application carries (convex/lib/queryBounds.ts). */
const MESSAGE_MAX = 500;

/** Every dialog about joining a community is this one, open while the address names it: `?apply=<community>`. */
export const useApplyParam = () => useQueryState(APPLY_PARAM, parseAsString);

type Card = NonNullable<FunctionReturnType<typeof api.evidenceLibraries.directory.card>>;
/** Where the person stands with a community: in it already, and their application to it, if any. */
export type Standing = FunctionReturnType<typeof api.evidenceLibraries.applications.standing>["page"][number];
type Application = NonNullable<Standing["application"]>;
/** The community an application is for, as its card and the sidebar draw it. */
export type AppliedCommunity = {
  libraryId: Card["_id"];
  name: string;
  faviconUrl: string | null;
  address: string;
  owner: { name: string; imageUrl: string | null; kind: "person" | "organization"; workspaceId?: string };
  applicationsOpen: boolean;
};
export const fromCard = (card: Card): AppliedCommunity => ({
  libraryId: card._id, name: card.name, faviconUrl: card.faviconUrl, address: card.address, applicationsOpen: card.applicationsOpen,
  owner: { name: card.owner.name ?? "", imageUrl: card.owner.imageUrl, kind: card.owner.kind, workspaceId: card.owner.workspaceId },
});

/** What the card or row that opens the dialog knows, so it opens with everything in it rather than filling in. */
export type ApplySeed = { community: AppliedCommunity; standing: Standing | null; returnTo?: HTMLElement | null };
const Seeds = createContext<(seed: ApplySeed) => void>(() => {});
export const ApplySeedProvider = Seeds.Provider;
/** Opens the dialog for a community, with what the caller knows of it. */
export function useOpenApply() {
  const [, open] = useApplyParam();
  const seed = useContext(Seeds);
  // The button that opened it gets the focus back when it closes, as a dialog's own trigger would.
  return (given: ApplySeed) => {
    seed({ ...given, returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null });
    void open(given.community.libraryId);
  };
}

/** A message being written, kept in the tab: closing the dialog by mistake doesn't lose it. */
const draftKey = (libraryId: string) => `apply-draft:${libraryId}`;
function readDraft(libraryId: string) {
  try { return sessionStorage.getItem(draftKey(libraryId)) ?? ""; } catch { return ""; }
}
function keepDraft(libraryId: string, text: string) {
  try { if (text) sessionStorage.setItem(draftKey(libraryId), text); else sessionStorage.removeItem(draftKey(libraryId)); } catch { /* storage off: nothing kept */ }
}

/**
 * Applying to join a community, and where an application stands. Opened from a card's Apply, a sidebar row, or a
 * community's own site, which links here. For someone signed in: signed out, Apply and that link go to sign-in first,
 * which comes back with this open (`applySignInPath`).
 */
export function ApplyDialog({ seed }: { seed: ApplySeed | null }) {
  const t = useTranslations("communityApplications");
  const [libraryId, setLibraryId] = useApplyParam();
  const workspaceId = useWorkspace();
  const seeded = seed && seed.community.libraryId === libraryId ? seed : null;
  const card = useQuery(api.evidenceLibraries.directory.card, libraryId ? { libraryId } : "skip");
  // Null: no public community by that ID, from a link to one since unlisted or a mistyped address. An application the
  // person opened from their sidebar still shows where it stands, as that row knew it.
  const community = card ? fromCard(card) : seeded ? seeded.community : card === null ? null : undefined;
  const id = community?.libraryId ?? seeded?.community.libraryId;
  const live = useProtectedQuery(api.evidenceLibraries.applications.standing, workspaceId && id ? { workspaceId, libraryIds: [id] } : "skip").data?.page[0];
  const standing = live ?? (seeded ? seeded.standing : undefined);
  // It opens once it knows what to show: the community, and where the person stands with it.
  const ready = community === null || (community !== undefined && standing !== undefined);
  // The success screen stays up after sending, until the dialog closes.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const close = () => { setSentTo(null); void setLibraryId(null); };
  const application = standing?.application ?? null;
  const waits = application?.state === "declined" && application.appliesAgainAt !== null && application.appliesAgainAt > Date.now();
  return (
    <Dialog open={Boolean(libraryId) && ready} onOpenChange={(open) => { if (!open) close(); }}>
      {/* Scrolls on a short screen, so Send is always reachable, without a scrollbar. */}
      <DialogContent
        className="gap-0 p-0 scrollbar-hide sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          // The seed still names its opener after the address stops naming the community.
          if (!seed?.returnTo?.isConnected) return;
          event.preventDefault();
          seed.returnTo.focus();
        }}
      >
        {community ? (
          <>
            <CommunityHeader community={community} />
            <AutoHeight>
              {sentTo === community.libraryId ? <Sent onDone={close} />
                : standing?.member ? <Member community={community} onClose={close} />
                : application?.state === "waiting" || waits ? <Status community={community} application={application!} onClose={close} />
                : !community.applicationsOpen ? <p className="p-5 text-sm text-muted-foreground">{t("closedNow")}</p>
                : <ApplyForm community={community} previous={application?.state === "declined" ? application : null} onSent={() => setSentTo(community.libraryId)} />}
            </AutoHeight>
          </>
        ) : (
          <DialogHeader className="p-5 pe-12">
            <DialogTitle className="text-base">{t("linkUnavailable")}</DialogTitle>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Who you're applying to: its icon over its accent, its name and who runs it. */
function CommunityHeader({ community }: { community: AppliedCommunity }) {
  const t = useTranslations("communityApplications");
  return (
    <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-border-subtle p-5 pe-12 text-start">
      <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-inset">
        <FadeImage src={community.faviconUrl ?? "/icon.svg"} fallback="/icon.svg" className="size-full object-cover" />
      </span>
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-base leading-snug">{t("joinName", { name: community.name })}</DialogTitle>
        <DialogDescription className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
          <WorkspaceTile workspace={{ kind: community.owner.kind === "organization" ? "organization" : "personal", name: community.owner.name, imageUrl: community.owner.imageUrl ?? undefined, workspaceId: community.owner.workspaceId }} size="xxs" />
          <span className="min-w-0 truncate">{t("runBy", { name: community.owner.name || t("anOpenscholarMember") })}</span>
        </DialogDescription>
      </div>
    </DialogHeader>
  );
}

/** `previous`: a declined application they may follow up, as when the team asked to hear more about their work. */
function ApplyForm({ community, previous, onSent }: { community: AppliedCommunity; previous: Application | null; onSent: () => void }) {
  const t = useTranslations("communityApplications");
  const apply = useWorkspaceMutation(api.evidenceLibraries.applications.apply);
  // Drawn once the dialog opens, in the browser: the tab's kept message is there from its first frame.
  const [draft, setDraft] = useState(() => readDraft(community.libraryId));
  const [missing, setMissing] = useState(false);
  const [refused, setRefused] = useState("");
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const write = (text: string) => {
    const kept = text.slice(0, MESSAGE_MAX);
    setMissing(false);
    setRefused("");
    setDraft(kept);
    keepDraft(community.libraryId, kept);
  };
  const send = async () => {
    if (!draft.trim()) { setMissing(true); field.current?.focus(); return; }
    setSending(true);
    try {
      await apply({ libraryId: community.libraryId, message: draft });
      keepDraft(community.libraryId, "");
      onSent();
    } catch (error) {
      setRefused(getErrorMessage(error, t("couldNotSend")));
    } finally {
      setSending(false);
    }
  };
  return (
    <form className="space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {previous ? (
        <div className="rounded-lg bg-inset p-3">
          <p className="text-xs font-medium">{t("theirReason")}</p>
          <p className="mt-1 whitespace-pre-line text-sm [overflow-wrap:anywhere]">
            {[previous.reasonPreset ? t(`reasons.${previous.reasonPreset}`) : "", previous.reason ?? ""].filter(Boolean).join("\n") || t("noReason")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{t("sayMore")}</p>
        </div>
      ) : null}
      <section aria-labelledby="apply-can">
        <h3 id="apply-can" className="text-sm font-medium">{t("asACreator")}</h3>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-3 sm:gap-2">
          <Can icon={AddedPapersIcon} title={t("can.add.title")}>{t("can.add.body")}</Can>
          <Can icon={PenLine} title={t("can.edit.title")}>{t("can.edit.body")}</Can>
          <Can icon={ReviewQueueIcon} title={t("can.review.title")}>{t("can.review.body")}</Can>
        </ul>
      </section>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="apply-message" className="text-sm font-medium">{t("messageLabel")}</label>
          {/* Left to right in every language, so it reads "64 / 500" and not the other way round. */}
          <span aria-hidden dir="ltr" className={cn("text-xs tabular-nums", draft.length >= MESSAGE_MAX ? "ink-warning" : "text-subtle-foreground")}>{draft.length} / {MESSAGE_MAX}</span>
        </div>
        <p id="apply-message-hint" className="mt-0.5 text-xs text-muted-foreground">{t("messageHint")}</p>
        <Textarea
          id="apply-message"
          ref={field}
          value={draft}
          onChange={(event) => write(event.target.value)}
          maxLength={MESSAGE_MAX}
          rows={5}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? "apply-message-hint apply-message-missing" : "apply-message-hint"}
          placeholder={t("messagePlaceholder")}
          className="mt-2 h-32 resize-none field-sizing-fixed [overflow-wrap:anywhere]"
        />
        {/* Its line is always there, so the error doesn't push the footer down. */}
        <p id="apply-message-missing" aria-live="polite" className="mt-1.5 min-h-4 text-xs text-destructive">{missing ? t("messageMissing") : refused || null}</p>
      </div>
      <p className="-mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-px size-3.5 shrink-0" />
        {t("whoSees")}
      </p>
      <DialogFooter className="-mx-5 -mb-5 border-t border-border-subtle bg-inset px-5 py-4">
        <DialogClose asChild><Button type="button" variant="outline">{t("cancel")}</Button></DialogClose>
        <Button type="submit" disabled={sending} aria-busy={sending}><Send />{t("send")}</Button>
      </DialogFooter>
    </form>
  );
}

function Can({ icon: Icon, title, children }: { icon: ComponentType<{ className?: string }>; title: string; children: ReactNode }) {
  return (
    // A row beside its icon on a phone, so the message and the buttons stay in view; a column of three from sm.
    <li className="flex gap-2.5 rounded-lg bg-inset px-3 py-2 sm:block sm:p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground sm:mt-2">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

/** Right after sending: what happens next, and where it waits. */
function Sent({ onDone }: { onDone: () => void }) {
  const t = useTranslations("communityApplications");
  const email = useUser().user?.primaryEmailAddress?.emailAddress ?? "";
  return (
    <div className="p-5">
      <div className="fade-enter flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-success/15 text-success"><Check className="size-5" /></span>
        <div>
          <p className="text-sm font-semibold">{t("sentTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("sentBody")}</p>
        </div>
      </div>
      <Steps
        className="mt-5"
        steps={[
          { icon: Check, tone: "done", title: t("steps.sent"), detail: t("steps.justNow") },
          { icon: Clock3, tone: "now", title: t("steps.review"), detail: t("steps.reviewDetail") },
          { icon: Mail, tone: "later", title: t("steps.email"), detail: email ? t("steps.emailTo", { email }) : undefined },
        ]}
      />
      <DialogFooter className="-mx-5 -mb-5 mt-5 border-t border-border-subtle bg-inset px-5 py-4">
        <Button onClick={onDone}>{t("done")}</Button>
      </DialogFooter>
    </div>
  );
}

/** Someone in the community already: an application of theirs was accepted, or they had a role before. */
function Member({ community, onClose }: { community: AppliedCommunity; onClose: () => void }) {
  const t = useTranslations("communityApplications");
  return (
    <div className="space-y-5 p-5">
      <p className="text-sm">{t("youreIn", { name: community.name })}</p>
      <DialogFooter className="-mx-5 -mb-5 border-t border-border-subtle bg-inset px-5 py-4 sm:justify-between">
        <Button asChild variant="outline"><a href={community.address} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("openCommunity")}</a></Button>
        <Button onClick={onClose}>{t("close")}</Button>
      </DialogFooter>
    </div>
  );
}

/** An application already sent: waiting, or declined with its reason and the wait, with what the person can do about it. */
function Status({ community, application, onClose }: { community: AppliedCommunity; application: Application; onClose: () => void }) {
  const t = useTranslations("communityApplications");
  const format = useFormatter();
  const withdraw = useWorkspaceMutation(api.evidenceLibraries.applications.withdraw);
  const hide = useWorkspaceMutation(api.evidenceLibraries.applications.hide);
  // The browser's clock: the page's own is the server's, from when it drew the page, and an application sent since reads as in the future.
  const now = Date.now();
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (change: () => Promise<unknown>) => {
    setBusy(true);
    try { await change(); onClose(); } catch (error) { toast.error(getErrorMessage(error, t("couldNotChange"))); } finally { setBusy(false); }
  };
  const sent = { icon: Check, tone: "done" as const, title: t("steps.sent"), detail: format.relativeTime(application.createdAt, now) };
  const steps = application.state === "waiting"
    ? [sent, { icon: Clock3, tone: "now" as const, title: t("steps.review"), detail: t("steps.reviewDetail") }, { icon: Mail, tone: "later" as const, title: t("steps.email") }]
    : [sent, { icon: XCircle, tone: "stopped" as const, title: t("steps.declined"), detail: format.relativeTime(application.decidedAt ?? application.createdAt, now) }];
  return (
    <div className="space-y-5 p-5">
      <Steps steps={steps} />
      {application.state === "declined" ? (
        <div className="rounded-lg bg-inset p-3">
          <p className="text-xs font-medium">{t("theirReason")}</p>
          {/* The ready-made reason in the applicant's own language, then what the team wrote. */}
          <p className="mt-1 whitespace-pre-line text-sm [overflow-wrap:anywhere]">
            {[application.reasonPreset ? t(`reasons.${application.reasonPreset}`) : "", application.reason ?? ""].filter(Boolean).join("\n") || t("noReason")}
          </p>
          {application.appliesAgainAt !== null ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("applyAgainFrom", { date: format.dateTime(application.appliesAgainAt, { day: "numeric", month: "long" }) })}</p>
          ) : null}
        </div>
      ) : null}
      <div>
        <p className="text-xs font-medium">{t("yourMessage")}</p>
        <blockquote className="mt-1 whitespace-pre-line border-s-2 border-border ps-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">{application.message}</blockquote>
      </div>
      <DialogFooter className="-mx-5 -mb-5 border-t border-border-subtle bg-inset px-5 py-4 sm:justify-between">
        {application.state === "waiting" ? (
          withdrawing ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("withdrawSure")}</span>
              <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>{t("keep")}</Button>
              <Button size="sm" variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void run(() => withdraw({ libraryId: community.libraryId }))}>{t("withdraw")}</Button>
            </div>
          ) : <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setWithdrawing(true)}>{t("withdraw")}</Button>
        ) : application.hidden ? <span /> : (
          <Button variant="ghost" disabled={busy} aria-busy={busy} onClick={() => void run(() => hide({ libraryId: community.libraryId }))}>{t("dismiss")}</Button>
        )}
        {withdrawing ? null : <Button onClick={onClose}>{t("close")}</Button>}
      </DialogFooter>
    </div>
  );
}

type Step = { icon: ComponentType<{ className?: string }>; tone: "done" | "now" | "later" | "stopped"; title: string; detail?: string };

/** Where an application is, as steps down a line: done, happening now, still to come, or stopped. */
function Steps({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn("relative space-y-4", className)}>
      {steps.map(({ icon: Icon, tone, title, detail }, index) => (
        <li key={title} className="relative flex gap-3">
          {index < steps.length - 1 ? <span aria-hidden className={cn("absolute start-[0.9375rem] top-8 -bottom-4 w-px", tone === "done" ? "bg-success/40" : "bg-border")} /> : null}
          <span className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            tone === "done" && "bg-success/15 text-success",
            tone === "now" && "bg-primary/10 text-primary ring-2 ring-primary/30",
            tone === "later" && "bg-inset text-subtle-foreground",
            tone === "stopped" && "bg-destructive/10 text-destructive",
          )}><Icon className="size-4" /></span>
          <div className="min-w-0 pt-1">
            <p className={cn("text-sm", tone === "later" ? "text-muted-foreground" : "font-medium")}>{title}</p>
            {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
