"use client";

import { useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import useSWR from "swr";
import { Check, Hourglass, PublishIcon, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EASE } from "@/components/settings/model-map";
import { CommunityIcon } from "@/components/evidence-libraries/your-communities";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { paperHref } from "@/lib/evidence-libraries/added-papers";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { useWorkspace } from "@/lib/workspaces/url";
import { cn } from "@/lib/utils";
import { KindTile } from "./steps";

/** The papers the card names one by one; past them, how many more. */
const SHOWN = 5;

/**
 * The ask before the assistant adds papers to a community: the community as Add to community shows it, the papers by
 * title, authors and year, and where they go. An owner or editor chooses Publish now or Review queue, starting from the
 * assistant's choice; anyone else's go to the queue, which the card says. `fallback` is the plain ask, for a call this
 * card can't read.
 */
export function AddPapersAsk({ threadId, stepId, fallback }: { threadId: Id<"assistantThreads">; stepId: Id<"assistantSteps">; fallback: ReactNode }) {
  const t = useTranslations("addedPapers");
  const asks = useTranslations("assistant.asks");
  const toast = useAppToast();
  const workspaceId = useWorkspace();
  const asked = useProtectedQuery(api.assistant.replies.askedPapers, { threadId, stepId }).data;
  const answer = useMutation(api.assistant.replies.answer);
  const preview = useAction(api.evidenceLibraries.assistant.previewPapers);
  const shown = asked?.papers.slice(0, SHOWN) ?? [];
  // What the community says of the papers the card names: read once, as the Add papers dialog reads them.
  const found = useSWR(asked && workspaceId ? ["ask-papers", stepId] : null, () => preview({ libraryId: asked!.libraryId, workspaceId: workspaceId!, papers: shown }), { revalidateOnFocus: false }).data;
  const [choice, setChoice] = useState<boolean | null>(null);
  // Pressed once: the buttons rest until the chat shows the answer, or says it couldn't be sent.
  const [sent, setSent] = useState(false);
  const reduceMotion = useReducedMotion();
  if (asked === undefined) return null;
  if (asked === null) return <>{fallback}</>;
  const publish = asked.canPublish && (choice ?? asked.publish);
  const count = asked.papers.length;
  const say = (allow: boolean) => {
    setSent(true);
    answer({ threadId, stepIds: [stepId], allow, ...(allow ? { publish } : {}) }).catch((error) => {
      setSent(false);
      toast.error(asks("failed"), getErrorMessage(error, ""));
    });
  };
  return (
    // It arrives once the call it asks about is read: laid out whole, its frame opens to it instead of the chat jumping.
    <motion.div initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0 }} transition={reduceMotion ? { duration: 0.2 } : { duration: 0.3, ease: EASE }} className="overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.04]">
      <div className="flex items-start gap-3 p-4 pb-3">
        <KindTile kind="library" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("askTitle", { count })}</p>
          {/* The community as Add to community lists it: its icon with its owner in the corner, its name, its owner. */}
          <div className="mt-2 flex min-w-0 items-center gap-2.5">
            <CommunityIcon community={{ faviconUrl: asked.community.faviconUrl, owner: { name: asked.community.owner?.name ?? "", imageUrl: asked.community.owner?.imageUrl ?? null, kind: asked.community.owner?.kind ?? "organization", workspaceId: asked.community.owner?.workspaceId } }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{asked.community.name}</p>
              {asked.community.owner?.name ? <p className="truncate text-xs text-muted-foreground">{asked.community.owner.name}</p> : null}
            </div>
          </div>
        </div>
        <TooltipHint label={asks("decline")}>
          <button type="button" aria-label={asks("decline")} disabled={sent} onClick={() => say(false)} className="-me-1 -mt-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
            <X className="size-4" />
          </button>
        </TooltipHint>
      </div>
      {/* The papers as their pages name them, once the community has looked them up; until then, as the call gives them, in rows of the same height. */}
      <ul className="mx-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-background">
        {shown.map((paper, at) => {
          const answer = found?.[at];
          const known = answer?.paper;
          return (
            <li key={at} className="flex h-14 items-center gap-3 px-3">
              <div className="min-w-0 flex-1">
                {known ? (
                  <a href={paperHref({ openalexId: known.openalexId, doi: known.doi, title: known.title })} target="_blank" rel="noopener noreferrer" className={cn("fade-enter line-clamp-1 text-sm font-medium hover:underline", answer.outcome === "existing" && "text-muted-foreground")}>
                    {known.title}
                  </a>
                ) : (
                  <p className="truncate font-mono text-xs text-muted-foreground">{paper.link ?? paper.openalexId ?? paper.doi}</p>
                )}
                <p className="mt-0.5 flex h-4 min-w-0 gap-2 text-xs text-muted-foreground">
                  {known ? (
                    <>
                      <span className="fade-enter min-w-0 truncate">{known.authors || t("noAuthors")}</span>
                      {known.year ? <span className="fade-enter shrink-0 tabular-nums">{known.year}</span> : null}
                    </>
                  ) : null}
                </p>
              </div>
              {answer?.outcome === "existing" ? (
                <StatusChip className="fade-enter shrink-0" tone="neutral" icon={Check}>{t("alreadyInIt")}</StatusChip>
              ) : answer?.outcome === "queued" ? (
                <StatusChip className="fade-enter shrink-0" tone="warning" icon={Hourglass}>{t("inReview")}</StatusChip>
              ) : answer?.outcome === "not_found" ? (
                <StatusChip className="fade-enter shrink-0" tone="danger" icon="tone">{t("notFound")}</StatusChip>
              ) : null}
            </li>
          );
        })}
        {count > SHOWN ? <li className="flex h-9 items-center px-3 text-xs text-muted-foreground">{asks("more", { count: count - SHOWN })}</li> : null}
      </ul>
      {/* Where they go. Owners and editors choose; anyone else's wait for review, which the card says instead. */}
      <div className="px-4 pt-3 pb-4">
        {asked.canPublish ? (
          <Tabs value={publish ? "publish" : "queue"} onValueChange={(value) => setChoice(value === "publish")}>
            <TabsList className="w-full">
              <TabsTrigger value="publish" disabled={sent}><PublishIcon />{t("publishNow")}</TabsTrigger>
              <TabsTrigger value="queue" disabled={sent}><Hourglass />{t("reviewQueue")}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <p className={cn("text-xs text-muted-foreground", asked.canPublish && "mt-2")}>{publish ? t("askPublishHint", { count, community: asked.community.name }) : t("askQueueHint", { count, community: asked.community.name })}</p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-primary/15 p-3">
        <Button className="h-9" disabled={sent} onClick={() => say(true)}>
          {publish ? <PublishIcon /> : <Hourglass />}
          {publish ? t("askPublish", { count }) : t("askQueue", { count })}
        </Button>
        <Button className="h-9 px-4" variant="secondary" disabled={sent} onClick={() => say(false)}>
          {asks("notNow")}
        </Button>
      </div>
    </motion.div>
  );
}
