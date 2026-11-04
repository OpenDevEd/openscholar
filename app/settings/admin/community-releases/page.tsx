"use client";

// MOCK: sample releases and communities, kept in this page's state. Nothing here reads or changes
// a real community. Its first run through TVET fails on purpose, to show a rollout stopping.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
  ChevronDown,
  CircleCheck,
  Database,
  ExternalLink,
  Library,
  RotateCcw,
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
import { cn } from "@/lib/utils";

type Channel = "prerelease" | "release";
type Release = { commit: string; date: string; summary: string; notes: string[]; databaseChanges: number; channel: Channel };
type Community = { id: string; name: string; records: number; on: string; previous?: string };

const RELEASES: Release[] = [
  { commit: "fcb66aa", date: "Nov 4", summary: "Closing an admin popover no longer lets a double-click open a record behind it.", notes: ["Administration: the second click of a double-click no longer opens the record behind a closing popover."], databaseChanges: 0, channel: "prerelease" },
  { commit: "7e3767c", date: "Nov 4", summary: "The Evidence Community adopts Openscholar's name and updated branding.", notes: ["Appearance: the site uses Openscholar's name, Hub mark and orange branding.", "Appearance: wording updated across all languages."], databaseChanges: 1, channel: "prerelease" },
  { commit: "8715943", date: "Nov 3", summary: "Evidence Libraries are now presented as Evidence Communities.", notes: ["Appearance: the site and admin area use Evidence Communities.", "Appearance: a new support address."], databaseChanges: 0, channel: "release" },
  { commit: "b9eb1b4", date: "Nov 3", summary: "The map responds again after returning with Back.", notes: ["Reliability: wheel, drag and click work on the map after returning with Back.", "Appearance: citation figures follow the page's decimal format."], databaseChanges: 0, channel: "release" },
  { commit: "364fbe8", date: "Nov 3", summary: "Home-page translations and focus after reverting admin edits are improved.", notes: ["Appearance: home-page example questions and country names follow the chosen language."], databaseChanges: 0, channel: "release" },
  { commit: "1df379a", date: "Nov 2", summary: "Digest and statistics labels now appear in the site's language.", notes: ["Appearance: digest ratios and author productivity ranges follow the site's language."], databaseChanges: 1, channel: "release" },
  { commit: "dfd9425", date: "Nov 2", summary: "A new language option is available for public pages.", notes: ["Appearance: communities can offer isiZulu in the language menu."], databaseChanges: 0, channel: "release" },
  { commit: "fcbb2f7", date: "Nov 2", summary: "Digest counts and policy dates are localized, and covers fit phone screens.", notes: ["Appearance: digest counts and policy dates follow the chosen language."], databaseChanges: 0, channel: "release" },
  { commit: "410158c", date: "Nov 2", summary: "Communities can offer Spanish and Afrikaans.", notes: ["Appearance: translated public text with language-specific dates and numbers."], databaseChanges: 2, channel: "release" },
  { commit: "f0f0be8", date: "Nov 2", summary: "Arrow keys reach older years without the Explore year list closing.", notes: ["Search: the year list stays open while moving through its options."], databaseChanges: 0, channel: "release" },
  { commit: "d835e2f", date: "Nov 2", summary: "Item type editing is more reliable in the admin area.", notes: ["Administration: leaving an unchanged Item type no longer saves a draft."], databaseChanges: 0, channel: "release" },
  { commit: "0f47ba0", date: "Nov 2", summary: "Filter menus avoid accidental selections when you press Tab.", notes: ["Search: Tab no longer changes filters or year ranges."], databaseChanges: 0, channel: "release" },
  { commit: "52c0298", date: "Nov 1", summary: "Tab moves past empty suggestion boxes without choosing an option.", notes: ["Search: tabbing out of an empty filter moves on without selecting."], databaseChanges: 0, channel: "release" },
  { commit: "994b101", date: "Oct 31", summary: "Phone users can tab into Explore's year fields.", notes: ["Search: Tab reaches the year fields after turning Year Range back on."], databaseChanges: 0, channel: "release" },
];

const COMMUNITIES: Community[] = [
  { id: "r176jnjsjfvmda1g2jfca8638n8en9r8", name: "Artificial Intelligence in Education", records: 290988, on: "8715943", previous: "b9eb1b4" },
  { id: "r17dv25e9pwnqanjsbsv1n79yx8fah5n", name: "Technical and Vocational Education and Training", records: 156875, on: "b9eb1b4", previous: "364fbe8" },
  { id: "r173827q49p5rtra2a28n5avpn8en7wm", name: "Climate Change Adaptation and Resilience", records: 152782, on: "b9eb1b4", previous: "1df379a" },
  { id: "r17az8jepnyqwss11yz50smkqd8gc3dk", name: "USAID", records: 84120, on: "364fbe8", previous: "dfd9425" },
  { id: "r177scvhy5cm45bdxheejxhvvd8gnn6g", name: "Wealth Inequality and Social Mobility", records: 61240, on: "364fbe8", previous: "fcbb2f7" },
  { id: "aime", name: "Artificial Intelligence in Measurement and Education", records: 18430, on: "dfd9425", previous: "410158c" },
  { id: "r1788ha2q316vhyaa1ghqvygbs8gbm09", name: "Demo", records: 2204, on: "8715943" },
  { id: "fcdo", name: "FCDO Demo", records: 1890, on: "fcbb2f7", previous: "f0f0be8" },
  { id: "sources-qa", name: "Sources Quality Assurance Library for Peer Tutoring", records: 1204, on: "dfd9425", previous: "fcbb2f7" },
  { id: "admin-qa", name: "Admin QA 8 October 2026", records: 880, on: "0f47ba0", previous: "52c0298" },
  { id: "opendeved", name: "OpenDevEd Test", records: 640, on: "8715943", previous: "b9eb1b4" },
  { id: "caitlin", name: "Caitlin QA 20260910", records: 412, on: "52c0298" },
  { id: "testinggg", name: "testinggg", records: 96, on: "994b101" },
];

const RELEASE_STEPS = ["Starting the new software", "Rebuilding its services", "Checking it's healthy"];
const STEP_MS = 1100;
const RELEASES_PER_PAGE = 6;
const RELEASE_ROW = 69;
const COMMUNITIES_PER_PAGE = 8;
const COMMUNITY_ROW = 61;

type Sort = "records" | "name" | "behind";
type Show = "all" | "behind" | "failed";
type Rollout = {
  kind: "update" | "rollback";
  queue: string[];
  done: number;
  step: number;
  failure?: string;
  /** Stops once the community it's on has finished. */
  stopping?: boolean;
  stopped?: boolean;
  /** TVET fails once, so a second try gets through. */
  retried?: boolean;
  target?: string;
};

const indexOf = (commit: string, releases: Release[]) => releases.findIndex((release) => release.commit === commit);

/** The database changes a community would have to undo to go back to its previous release. */
function changesToUndo(community: Community, releases: Release[]) {
  if (!community.previous) return null;
  const from = indexOf(community.on, releases);
  const to = indexOf(community.previous, releases);
  return releases.slice(from, to).reduce((sum, release) => sum + release.databaseChanges, 0);
}

export default function CommunityReleasesPage() {
  const [releases, setReleases] = useState(RELEASES);
  const [communities, setCommunities] = useState(COMMUNITIES);
  const [channel, setChannel] = useState<Channel>("prerelease");
  const [open, setOpen] = useState<string | null>(null);
  const [releasePage, setReleasePage] = useState(1);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("records");
  const [communityPage, setCommunityPage] = useState(1);
  const [confirm, setConfirm] = useState<"update" | "rollback" | null>(null);
  const [rollout, setRollout] = useState<Rollout | null>(null);

  const latest = releases.find((release) => release.channel === "release")!;
  const latestIndex = indexOf(latest.commit, releases);
  const behindBy = (community: Community) => Math.max(0, indexOf(community.on, releases) - latestIndex);
  const behind = communities.filter((community) => behindBy(community) > 0);
  const canRollBack = (community: Community) => changesToUndo(community, releases) === 0;
  const rollbackable = communities.filter(canRollBack);
  const blocked = communities.filter((community) => (changesToUndo(community, releases) ?? 0) > 0);
  const running = rollout !== null && rollout.done < rollout.queue.length && !rollout.failure && !rollout.stopped;
  const busy = rollout !== null && rollout.done < rollout.queue.length && !rollout.stopped;
  const current = rollout?.queue[rollout.done];
  const newChanges = releases.slice(latestIndex, Math.max(...behind.map((community) => indexOf(community.on, releases)), latestIndex)).reduce((sum, release) => sum + release.databaseChanges, 0);

  // The mock's stand-in for a deployment's steps: a timer, cleared if the step changes first.
  useEffect(() => {
    if (!running || !rollout) return;
    const timer = setTimeout(() => {
      const id = rollout.queue[rollout.done]!;
      if (rollout.kind === "update" && id === "r17dv25e9pwnqanjsbsv1n79yx8fah5n" && rollout.step === 1 && !rollout.retried) {
        setRollout({ ...rollout, failure: "The search indexer didn't become healthy in time. Visitors are still on the old release." });
        return;
      }
      if (rollout.step < RELEASE_STEPS.length - 1) {
        setRollout({ ...rollout, step: rollout.step + 1 });
        return;
      }
      setCommunities((list) =>
        list.map((community) =>
          community.id !== id
            ? community
            : rollout.kind === "update"
              ? { ...community, on: rollout.target ?? latest.commit, previous: community.on }
              : { ...community, on: community.previous!, previous: undefined },
        ),
      );
      setRollout({ ...rollout, done: rollout.done + 1, step: 0, stopped: rollout.stopping });
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [rollout, running, latest.commit]);

  const shownReleases = releases.filter((release) => release.channel === channel);
  const releasePager = pagerOf(shownReleases.length, RELEASES_PER_PAGE, releasePage, setReleasePage);
  const releaseRows = shownReleases.slice((releasePager.page - 1) * RELEASES_PER_PAGE, releasePager.page * RELEASES_PER_PAGE);

  const failedId = rollout?.failure ? current : undefined;
  const shownCommunities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return communities
      .filter((community) => !needle || community.name.toLowerCase().includes(needle))
      .filter((community) => show === "all" || (show === "behind" ? indexOf(community.on, releases) > latestIndex : community.id === failedId))
      .toSorted((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "behind" ? indexOf(b.on, releases) - indexOf(a.on, releases) : b.records - a.records));
  }, [communities, query, show, sort, releases, latestIndex, failedId]);
  const communityPager = pagerOf(shownCommunities.length, COMMUNITIES_PER_PAGE, communityPage, setCommunityPage);
  const communityRows = shownCommunities.slice((communityPager.page - 1) * COMMUNITIES_PER_PAGE, communityPager.page * COMMUNITIES_PER_PAGE);

  const move = (commit: string, to: Channel) => {
    setReleases((list) => list.map((release) => (release.commit === commit ? { ...release, channel: to } : release)));
    setOpen(null);
  };

  // Smallest first: a bad release shows up on the cheapest community to fix.
  const start = (kind: "update" | "rollback", list: Community[]) =>
    setRollout({ kind, queue: list.toSorted((a, b) => a.records - b.records).map((community) => community.id), done: 0, step: 0, target: latest.commit });

  const nameOf = (id?: string) => communities.find((community) => community.id === id)?.name ?? "";
  const finished = rollout !== null && rollout.done >= rollout.queue.length;
  const total = rollout?.queue.length ?? 0;
  const progress = rollout ? ((rollout.done + (finished ? 0 : rollout.step / RELEASE_STEPS.length)) / Math.max(total, 1)) * 100 : 0;

  return (
    <MotionConfig reducedMotion="user">
      <Enter ready>
        <div className="space-y-8">
          <Zone
            label="Releases"
            aside={
              <Segmented
                label="Which releases"
                value={channel}
                onChange={(next) => {
                  setChannel(next);
                  setReleasePage(1);
                  setOpen(null);
                }}
                options={[
                  { id: "prerelease" as const, label: `Prerelease ${releases.filter((release) => release.channel === "prerelease").length}` },
                  { id: "release" as const, label: `Release ${releases.filter((release) => release.channel === "release").length}` },
                ]}
              />
            }
          >
            <Paged pager={releasePager} rowHeight={RELEASE_ROW} label="releases">
              {shownReleases.length === 0 ? (
                <p className={cn(LIST, "py-10 text-center text-sm text-muted-foreground")}>Every release has been promoted</p>
              ) : (
                <ul className={LIST}>
                  {releaseRows.map((release) => {
                    const on = communities.filter((community) => community.on === release.commit).length;
                    const expanded = open === release.commit;
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
                              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">{release.commit}</code>
                              <span>{release.date}</span>
                              {on > 0 ? (
                                <span className="inline-flex items-center gap-1 ps-1">
                                  <Library className="size-3" /> {on === 1 ? "1 community" : `${on} communities`}
                                </span>
                              ) : null}
                              {release.databaseChanges > 0 ? (
                                <span className="inline-flex items-center gap-1 ps-1 ink-warning">
                                  <Database className="size-3" /> {release.databaseChanges === 1 ? "1 database change" : `${release.databaseChanges} database changes`}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {release.channel === "prerelease" ? (
                            <Button size="sm" onClick={() => move(release.commit, "release")}>
                              <UpgradeIcon /> Promote
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => move(release.commit, "prerelease")}>
                              Pull back
                            </Button>
                          )}
                          <TooltipHint label="Open on GitHub">
                            <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground">
                              <a href={`https://github.com/OpenDevEd/new-el/commit/${release.commit}`} target="_blank" rel="noopener noreferrer" aria-label="Open on GitHub">
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
            label="Communities"
            aside={
              <div className="flex items-center gap-2">
                {rollbackable.length > 0 ? (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm("rollback")}>
                    <RotateCcw /> Roll back all
                  </Button>
                ) : (
                  <TooltipHint label="Going back would undo database changes on every community">
                    {/* A disabled button takes no pointer, so its reason hangs on a wrapper that does. */}
                    <span tabIndex={0} className="inline-flex rounded-md">
                      <Button variant="outline" size="sm" disabled>
                        <RotateCcw /> Roll back all
                      </Button>
                    </span>
                  </TooltipHint>
                )}
                <Button size="sm" disabled={busy || behind.length === 0} onClick={() => setConfirm("update")}>
                  <UpgradeIcon /> Update all
                  <span className="rounded-full bg-primary-foreground/15 px-1.5 text-2xs tabular-nums">
                    <AnimatedNumber value={behind.length} />
                  </span>
                </Button>
              </div>
            }
          >
            <AnimatePresence initial={false}>
              {rollout ? (
                <Opening key="rollout">
                  <div className="mb-3 space-y-3 rounded-2xl border border-border-subtle bg-inset p-4">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {rollout.failure
                            ? `Stopped at ${nameOf(current)}`
                            : finished
                              ? rollout.kind === "update"
                                ? "Every community is updated"
                                : "Every community is rolled back"
                              : rollout.stopped
                                ? "Stopped"
                                : nameOf(current)}
                        </p>
                        <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", rollout.failure && "ink-warning")}>
                          {rollout.failure ?? (finished || rollout.stopped ? `${rollout.done} of ${total} done` : RELEASE_STEPS[rollout.step])}
                        </p>
                      </div>
                      {finished || rollout.stopped ? (
                        <Button variant="outline" size="sm" onClick={() => setRollout(null)}>
                          Done
                        </Button>
                      ) : rollout.failure ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setRollout({ ...rollout, failure: undefined, done: rollout.done + 1, step: 0 })}>
                            Skip
                          </Button>
                          <Button size="sm" onClick={() => setRollout({ ...rollout, failure: undefined, retried: true, step: 0 })}>
                            Try again
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" disabled={rollout.stopping} onClick={() => setRollout({ ...rollout, stopping: true })}>
                          {rollout.stopping ? "Stopping after this one" : "Stop after this one"}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className={cn("h-full rounded-full", rollout.failure ? "bg-warning" : "bg-primary")}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.6, ease: EASE }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        <AnimatedNumber value={rollout.done} /> of {total}
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
                    placeholder="Find a community"
                    aria-label="Find a community"
                    className="h-9 ps-9"
                  />
                </div>
                <Segmented
                  label="Which communities"
                  value={show}
                  onChange={(next) => {
                    setShow(next);
                    setCommunityPage(1);
                  }}
                  options={[
                    { id: "all" as const, label: "All" },
                    { id: "behind" as const, label: "Behind" },
                    { id: "failed" as const, label: "Failed" },
                  ]}
                />
                <Select value={sort} onValueChange={(next) => setSort(next as Sort)}>
                  <SelectTrigger size="sm" className="w-36" aria-label="Sort communities">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="records">Most records</SelectItem>
                    <SelectItem value="behind">Furthest behind</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Paged pager={communityPager} rowHeight={COMMUNITY_ROW} label="communities">
                {communityRows.length === 0 ? (
                  <p className={cn(LIST, "py-10 text-center text-sm text-muted-foreground")}>No communities match</p>
                ) : (
                  <ul className={LIST}>
                    {communityRows.map((community) => {
                      const place = rollout?.queue.indexOf(community.id) ?? -1;
                      const here = busy && place === rollout?.done;
                      const failed = here && Boolean(rollout?.failure);
                      const queued = busy && place > (rollout?.done ?? 0);
                      const count = behindBy(community);
                      const undo = changesToUndo(community, releases);
                      return (
                        <li key={community.id} className="flex h-[60px] items-center gap-3 px-3">
                          <Tile icon={Library} tint="#d97706" />
                          <div className="min-w-0 flex-1">
                            <TooltipHint label={community.name} onlyWhenClipped>
                              <p className="truncate text-sm font-medium">{community.name}</p>
                            </TooltipHint>
                            <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
                              <code className="font-mono text-2xs">{community.on}</code>
                              <span className="tabular-nums">{community.records.toLocaleString()} records</span>
                            </p>
                          </div>
                          {failed ? (
                            <StatusChip tone="danger" icon={TriangleAlert}>
                              Failed
                            </StatusChip>
                          ) : here ? (
                            <StatusChip tone="running" icon="tone">
                              {rollout?.kind === "update" ? "Updating" : "Rolling back"}
                            </StatusChip>
                          ) : queued ? (
                            <StatusChip tone="neutral">Queued</StatusChip>
                          ) : count > 0 ? (
                            <StatusChip tone="neutral">{count} behind</StatusChip>
                          ) : (
                            <StatusChip tone="success" icon={CircleCheck}>
                              Up to date
                            </StatusChip>
                          )}
                          <Button variant="outline" size="sm" className="w-[84px]" disabled={busy || count === 0} onClick={() => start("update", [community])}>
                            {here && rollout?.kind === "update" && !failed ? <Spinner /> : null}
                            Update
                          </Button>
                          {undo === 0 ? (
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => start("rollback", [community])}>
                              <RotateCcw /> Roll back
                            </Button>
                          ) : (
                            <TooltipHint label={undo === null ? "No earlier release to go back to" : "The last update changed the database, so this can't go back"}>
                              <span tabIndex={0} className="inline-flex rounded-md">
                                <Button variant="ghost" size="sm" disabled>
                                  <RotateCcw /> Roll back
                                </Button>
                              </span>
                            </TooltipHint>
                          )}
                          <TooltipHint label="Open this community">
                            <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground">
                              <a href={`/evidence-communities/${community.id}/configuration`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${community.name}`}>
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

        <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
          <AlertDialogContent>
            {confirm === "rollback" ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Roll back {rollbackable.length === 1 ? "1 community" : `${rollbackable.length} communities`}?</AlertDialogTitle>
                  <AlertDialogDescription>Each goes back to the release it was on before, one at a time, smallest first.</AlertDialogDescription>
                </AlertDialogHeader>
                {blocked.length > 0 ? (
                  <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                    <Database className="mt-0.5 size-4 shrink-0" />
                    {blocked.length === 1 ? "1 community stays where it is" : `${blocked.length} communities stay where they are`}: their last update changed the database.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Update {behind.length === 1 ? "1 community" : `${behind.length} communities`} to {latest.commit}?</AlertDialogTitle>
                  <AlertDialogDescription>One at a time, smallest first. It stops at the first failure, and visitors stay on the old release if one fails.</AlertDialogDescription>
                </AlertDialogHeader>
                {newChanges > 0 ? (
                  <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                    <Database className="mt-0.5 size-4 shrink-0" />
                    Some of these updates change the database, so those communities can&apos;t roll back afterwards.
                  </p>
                ) : null}
              </>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => (confirm === "rollback" ? start("rollback", rollbackable) : start("update", behind))}>
                {confirm === "rollback" ? "Roll back" : "Update"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Enter>
    </MotionConfig>
  );
}
