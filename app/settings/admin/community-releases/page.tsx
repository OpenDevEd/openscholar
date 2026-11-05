"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ChevronDown,
  CircleCheck,
  Database,
  ExternalLink,
  Library,
  Search,
  TriangleAlert,
  UpgradeIcon,
} from "@/components/icons";
import { AnimatedNumber } from "@/components/screening/parts";
import { Enter, LIST, Paged, Segmented, Tile, Zone, pagerOf } from "@/components/settings/parts";
import { EASE } from "@/components/settings/model-map";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { Opening } from "@/components/workspaces/parts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TooltipHint } from "@/components/ui/tooltip";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { releasesBehind } from "@/lib/evidence-libraries/runtime-position";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";

const RELEASES_PER_PAGE = 6;
const RELEASE_ROW = 69;
const COMMUNITIES_PER_PAGE = 8;
const COMMUNITY_ROW = 61;

type Channel = "prerelease" | "release";
type Sort = "records" | "name" | "behind";
type Show = "all" | "behind" | "failed";

/** Each step a person sees, from the deployment stages it covers. */
const STEPS = [
  { label: "stepStarting", stages: ["queued", "assembling", "validating", "publishing"] },
  { label: "stepRebuilding", stages: ["activating", "database", "storage", "application", "coolify", "deployment"] },
  { label: "stepChecking", stages: ["health_check", "convex", "completed"] },
] as const;
const stepOf = (stage: string | null) => Math.max(0, STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage ?? "")));

/** Which releases communities can take, and moving them onto the newest, one at a time. */
export default function CommunityReleasesPage() {
  const t = useTranslations("settingsAdmin.communityReleases");
  const tc = useTranslations("common");
  const format = useFormatter();
  const { data } = useProtectedQuery(api.evidenceLibraries.releases.overview, {});
  const setChannelOn = useAction(api.evidenceLibraries.releases.setChannel);
  const startRollout = useAction(api.evidenceLibraries.releases.startRollout);
  const steerRollout = useMutation(api.evidenceLibraries.releases.steerRollout);
  const [channel, setChannel] = useState<Channel>("prerelease");
  const [open, setOpen] = useState<string | null>(null);
  const [releasePage, setReleasePage] = useState(1);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("records");
  const [communityPage, setCommunityPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const releases = useMemo(() => data?.releases ?? [], [data?.releases]);
  const communities = useMemo(() => data?.communities ?? [], [data?.communities]);
  const latest = data?.latest ?? null;
  const rollout = data?.rollout ?? null;
  const behindBy = useMemo(() => {
    const counts = new Map(communities.map((community) => [community.id, latest ? releasesBehind(community.running, latest, releases) : 0]));
    return (id: Id<"evidenceLibraries">) => counts.get(id) ?? 0;
  }, [communities, latest, releases]);
  const behind = communities.filter((community) => behindBy(community.id) > 0);
  const busy = rollout?.state === "running" || rollout?.state === "failed" || starting;
  const failure = rollout?.state === "failed" ? rollout.failure : undefined;
  const current = rollout ? rollout.queue[rollout.done] : undefined;
  const failedId = rollout?.state === "failed" ? current : undefined;

  const shownCommunities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return communities
      .filter((community) => !needle || community.name.toLowerCase().includes(needle))
      .filter((community) => show === "all" || (show === "behind" ? behindBy(community.id) > 0 : community.id === failedId))
      .toSorted((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "behind" ? behindBy(b.id) - behindBy(a.id) : b.records - a.records));
  }, [communities, query, show, sort, behindBy, failedId]);

  if (!data) return <Enter ready={false}>{null}</Enter>;

  const shownReleases = releases.filter((release) => release.prerelease === (channel === "prerelease"));
  const releasePager = pagerOf(shownReleases.length, RELEASES_PER_PAGE, releasePage, setReleasePage);
  const releaseRows = shownReleases.slice((releasePager.page - 1) * RELEASES_PER_PAGE, releasePager.page * RELEASES_PER_PAGE);
  const communityPager = pagerOf(shownCommunities.length, COMMUNITIES_PER_PAGE, communityPage, setCommunityPage);
  const communityRows = shownCommunities.slice((communityPager.page - 1) * COMMUNITIES_PER_PAGE, communityPager.page * COMMUNITIES_PER_PAGE);

  // The releases those communities would take, from the newest offered down to the furthest behind.
  const latestIndex = releases.findIndex((release) => release.commit === latest);
  const furthest = Math.max(0, ...behind.map((community) => behindBy(community.id)));
  const changesDatabase = latestIndex !== -1 && releases.slice(latestIndex, latestIndex + furthest).some((release) => (release.databaseChanges ?? 0) > 0);

  const nameOf = (id?: Id<"evidenceLibraries">) => communities.find((community) => community.id === id)?.name ?? "";
  const failed = (error: unknown) => toast.error(getErrorMessage(error, tc("somethingWentWrong")));
  const move = (commit: string, prerelease: boolean) => {
    setChanging(commit);
    setOpen(null);
    void setChannelOn({ commit, prerelease })
      .catch(failed)
      .finally(() => setChanging(null));
  };
  const start = (libraryId?: Id<"evidenceLibraries">) => {
    setStarting(true);
    void startRollout(libraryId ? { libraryId } : {})
      .catch(failed)
      .finally(() => setStarting(false));
  };
  const steer = (action: "stopAfterThis" | "skip" | "retry" | "stop" | "dismiss") => void steerRollout({ action }).catch(failed);

  const finished = rollout?.state === "finished";
  const stopped = rollout?.state === "stopped";
  const total = rollout?.queue.length ?? 0;
  const step = stepOf(rollout?.stage ?? null);
  const progress = rollout ? ((rollout.done + (rollout.state === "running" ? step / STEPS.length : 0)) / Math.max(total, 1)) * 100 : 0;

  return (
    <MotionConfig reducedMotion="user">
      <Enter ready>
        {/* Taller than the settings card it's in, and sized by data that arrives after the card shows: it opens the card. */}
        <Opening className="overflow-clip [overflow-clip-margin:8px]">
        <div className="space-y-8">
          <Zone
            label={t("releases")}
            aside={
              <Segmented
                label={t("whichReleases")}
                value={channel}
                onChange={(next) => {
                  setChannel(next);
                  setReleasePage(1);
                  setOpen(null);
                }}
                options={[
                  { id: "prerelease" as const, label: t("prerelease", { count: releases.filter((release) => release.prerelease).length }) },
                  { id: "release" as const, label: t("release", { count: releases.filter((release) => !release.prerelease).length }) },
                ]}
              />
            }
          >
            <Paged pager={releasePager} rowHeight={RELEASE_ROW} label={t("releaseItems")}>
              {shownReleases.length === 0 ? (
                <p className={cn(LIST, "py-10 text-center text-sm text-muted-foreground")}>{channel === "prerelease" ? t("allPromoted") : t("nonePromoted")}</p>
              ) : (
                <ul className={LIST}>
                  {releaseRows.map((release) => {
                    const on = communities.filter((community) => community.running === release.commit).length;
                    const expanded = open === release.commit;
                    const changes = release.databaseChanges ?? 0;
                    return (
                      <li key={release.commit}>
                        <div className="flex min-h-[68px] items-center gap-3 px-4 py-3">
                          <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : release.commit)} className="min-w-0 flex-1 text-start">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{release.summary}</span>
                              <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.25, ease: EASE }} className="shrink-0 text-muted-foreground">
                                <ChevronDown className="size-3.5" />
                              </motion.span>
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">{release.commit.slice(0, 7)}</code>
                              <span>{format.dateTime(release.publishedAt, { month: "short", day: "numeric" })}</span>
                              {on > 0 ? (
                                <span className="inline-flex items-center gap-1 ps-1">
                                  <Library className="size-3" /> {t("communitiesOn", { count: on })}
                                </span>
                              ) : null}
                              {changes > 0 ? (
                                <span className="inline-flex items-center gap-1 ps-1 ink-warning">
                                  <Database className="size-3" /> {t("databaseChanges", { count: changes })}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {release.prerelease ? (
                            <Button size="sm" disabled={changing !== null} onClick={() => move(release.commit, false)}>
                              {changing === release.commit ? <Spinner /> : <UpgradeIcon />} {t("promote")}
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" disabled={changing !== null} onClick={() => move(release.commit, true)}>
                              {changing === release.commit ? <Spinner /> : null}
                              {t("pullBack")}
                            </Button>
                          )}
                          <TooltipHint label={t("openOnGithub")}>
                            <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground">
                              <a href={`https://github.com/OpenDevEd/new-el/commit/${release.commit}`} target="_blank" rel="noopener noreferrer" aria-label={t("openOnGithub")}>
                                <ExternalLink />
                              </a>
                            </Button>
                          </TooltipHint>
                        </div>
                        <AnimatePresence initial={false}>
                          {expanded ? (
                            <Opening key="notes">
                              <ul className="space-y-1 bg-inset px-4 py-3 text-xs text-muted-foreground">
                                {release.notes.map((note) => (
                                  <li key={note}>{note}</li>
                                ))}
                              </ul>
                            </Opening>
                          ) : null}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Paged>
          </Zone>

          <Zone
            label={t("communities")}
            aside={
              <Button size="sm" disabled={busy || behind.length === 0} onClick={() => setConfirming(true)}>
                <UpgradeIcon /> {t("updateAll")}
                <span className="rounded-full bg-primary-foreground/15 px-1.5 text-2xs tabular-nums">
                  <AnimatedNumber value={behind.length} />
                </span>
              </Button>
            }
          >
            <AnimatePresence initial={false}>
              {rollout ? (
                <Opening key="rollout">
                  <div className="mb-3 space-y-3 rounded-2xl border border-border-subtle bg-inset p-4">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {failure !== undefined
                            ? t("stoppedAt", { name: nameOf(current) })
                            : finished
                              ? rollout.skipped > 0
                                ? t("finishedSkipped", { count: rollout.skipped })
                                : t("everyUpdated")
                              : stopped
                                ? t("stopped")
                                : nameOf(current)}
                        </p>
                        <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", failure !== undefined && "ink-warning")}>
                          {failure ?? (finished || stopped ? t("doneOf", { done: rollout.done - rollout.skipped, total }) : t(STEPS[step]!.label))}
                        </p>
                      </div>
                      {finished || stopped ? (
                        <Button variant="outline" size="sm" onClick={() => steer("dismiss")}>
                          {t("done")}
                        </Button>
                      ) : failure !== undefined ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => steer("stop")}>
                            {t("stop")}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => steer("skip")}>
                            {t("skip")}
                          </Button>
                          <Button size="sm" onClick={() => steer("retry")}>
                            {t("tryAgain")}
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" disabled={rollout.stopping} onClick={() => steer("stopAfterThis")}>
                          {rollout.stopping ? t("stopping") : t("stopAfter")}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className={cn("h-full rounded-full", failure !== undefined ? "bg-warning" : "bg-primary")}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.6, ease: EASE }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        <AnimatedNumber value={rollout.done} /> {t("ofTotal", { total })}
                      </span>
                    </div>
                  </div>
                </Opening>
              ) : null}
            </AnimatePresence>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setCommunityPage(1);
                    }}
                    placeholder={t("find")}
                    aria-label={t("find")}
                    className="h-9 ps-9"
                  />
                </div>
                <Segmented
                  label={t("whichCommunities")}
                  value={show}
                  onChange={(next) => {
                    setShow(next);
                    setCommunityPage(1);
                  }}
                  options={[
                    { id: "all" as const, label: t("all") },
                    { id: "behind" as const, label: t("behind") },
                    { id: "failed" as const, label: t("failed") },
                  ]}
                />
                <Select value={sort} onValueChange={(next) => setSort(next as Sort)}>
                  <SelectTrigger size="sm" className="w-36" aria-label={t("sort")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="records">{t("mostRecords")}</SelectItem>
                    <SelectItem value="behind">{t("furthestBehind")}</SelectItem>
                    <SelectItem value="name">{t("name")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Paged pager={communityPager} rowHeight={COMMUNITY_ROW} label={t("communityItems")}>
                {communityRows.length === 0 ? (
                  <p className={cn(LIST, "py-10 text-center text-sm text-muted-foreground")}>{t("noMatches")}</p>
                ) : (
                  <ul className={LIST}>
                    {communityRows.map((community) => {
                      const place = rollout?.queue.indexOf(community.id) ?? -1;
                      const going = rollout?.state === "running" || rollout?.state === "failed";
                      const here = going && place === rollout?.done;
                      const failedHere = here && rollout?.state === "failed";
                      const queued = going && place > (rollout?.done ?? 0);
                      const count = behindBy(community.id);
                      return (
                        <li key={community.id} className="flex h-[60px] items-center gap-3 px-3">
                          <Tile icon={Library} tint="#d97706" />
                          <div className="min-w-0 flex-1">
                            <TooltipHint label={community.name} onlyWhenClipped>
                              <p className="truncate text-sm font-medium">{community.name}</p>
                            </TooltipHint>
                            <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
                              <code className="font-mono text-2xs">{community.running.slice(0, 7)}</code>
                              <span className="tabular-nums">{t("records", { count: community.records })}</span>
                            </p>
                          </div>
                          {failedHere ? (
                            <StatusChip tone="danger" icon={TriangleAlert}>
                              {t("failed")}
                            </StatusChip>
                          ) : here ? (
                            <StatusChip tone="running" icon="tone">
                              {t("updating")}
                            </StatusChip>
                          ) : queued ? (
                            <StatusChip tone="neutral">{t("queued")}</StatusChip>
                          ) : count > 0 ? (
                            <StatusChip tone="neutral">{t("behindBy", { count })}</StatusChip>
                          ) : (
                            <StatusChip tone="success" icon={CircleCheck}>
                              {t("upToDate")}
                            </StatusChip>
                          )}
                          <Button variant="outline" size="sm" className="w-[84px]" disabled={busy || count === 0} onClick={() => start(community.id)}>
                            {here && !failedHere ? <Spinner /> : null}
                            {t("update")}
                          </Button>
                          <TooltipHint label={t("openCommunity")}>
                            <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground">
                              <a href={community.address} target="_blank" rel="noopener noreferrer" aria-label={t("openCommunity")}>
                                <ExternalLink />
                              </a>
                            </Button>
                          </TooltipHint>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Paged>
            </div>
          </Zone>
        </div>
        </Opening>

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("confirmTitle", { count: behind.length, commit: latest?.slice(0, 7) ?? "" })}</AlertDialogTitle>
              <AlertDialogDescription>{t("confirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            {changesDatabase ? (
              <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                <Database className="mt-0.5 size-4 shrink-0" />
                {t("confirmDatabase")}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => start()}>{t("update")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Enter>
    </MotionConfig>
  );
}
