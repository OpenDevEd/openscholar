"use client";

// A new screening: where its papers come from, the criteria, who reads them, how a paper is
// decided and where the included ones go. The cost stays in view beside the form.
// Placeholder data (./data.ts): nothing is read, charged or saved.

import { useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AiIcon, Asterisk, Ban, Check, ChevronDown, Coins, FileText, Folder, FolderPlus, Gauge, ListChecks, Plus, Trash2, Upload, type AppIcon } from "@/components/icons";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { AnimatedNumber, Chip, Meter, SOURCE_ICON } from "@/components/screening/parts";
import { PickMark } from "@/components/screening/source-row";
import { EASE } from "@/components/settings/model-map";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { EmailAvatar, YouTag } from "@/components/ui/identity";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import { cn } from "@/lib/utils";
import { CRITERIA, MORE_REVIEWERS, PAPERS, REVIEWERS, SOURCES, YOU, count, type Reviewer } from "./data";
import { CriterionText, ReviewerMark, ReviewerStack } from "./parts";

type Row = { id: string; icon: AppIcon; name: string; detail: string; found: number; duplicates: number; facts?: string[] };
type Kind = "search" | "collection" | "saved" | "screening" | "evidenceLibrary" | "zotero" | "upload";
const KINDS: Array<{ id: Kind; label: string; icon: AppIcon }> = [
  { id: "search", label: "Search", icon: SOURCE_ICON.search },
  { id: "collection", label: "Collection", icon: SOURCE_ICON.collection },
  { id: "saved", label: "Saved", icon: SOURCE_ICON.saved },
  { id: "screening", label: "Screening", icon: SOURCE_ICON.screening },
  { id: "evidenceLibrary", label: "Community", icon: SOURCE_ICON.evidenceLibrary },
  { id: "zotero", label: "Zotero", icon: SOURCE_ICON.zotero },
  { id: "upload", label: "Upload", icon: Upload },
];
/** What each kind offers to add, made up. */
const OFFERED: Record<Exclude<Kind, "upload">, Array<{ name: string; detail: string; found: number }>> = {
  search: [
    { name: "structured pedagogy AND early grade reading", detail: "Searched yesterday", found: 318 },
    { name: "teaching at the right level", detail: "Searched 3 days ago", found: 96 },
    { name: "school feeding AND learning outcomes", detail: "Searched last week", found: 207 },
  ],
  collection: [
    { name: "Foundational learning, core set", detail: "Collection", found: 64 },
    { name: "To read: numeracy", detail: "Collection", found: 23 },
  ],
  saved: [{ name: "All saved papers", detail: "This workspace's library", found: 412 }],
  screening: [{ name: "Included in TVET and youth employment", detail: "Screening", found: 212 }],
  evidenceLibrary: [{ name: "EdTech Hub Evidence Community", detail: "Whole community", found: 1280 }],
  zotero: [{ name: "Literacy review 2026", detail: "Zotero group collection", found: 154 }],
};
const UPLOADS: Row[] = [
  { id: "u1", icon: FileText, name: "scopus-export.ris", detail: "Reference file", found: 86, duplicates: 22, facts: ["79 matched to our index", "4 without an abstract"] },
  { id: "u2", icon: FileText, name: "grey-literature.bib", detail: "Reference file", found: 17, duplicates: 1, facts: ["9 matched to our index", "6 without an abstract"] },
  { id: "u3", icon: FileText, name: "3 PDFs", detail: "Read from the files", found: 3, duplicates: 0, facts: ["3 titles and abstracts read", "Kept as each paper's full text"] },
];
const COLLECTIONS = [{ id: "c1", name: "Foundational learning, core set", papers: 64 }, { id: "c2", name: "To read: numeracy", papers: 23 }];
const BALANCE = 18_420;

export function ScreeningSetup() {
  const [name, setName] = useState("");
  const [sources, setSources] = useState<Row[]>(() =>
    SOURCES.map((source) => ({
      id: source.id,
      icon: source.kind === "search" ? SOURCE_ICON.search : FileText,
      name: source.name,
      detail: source.detail,
      found: count(PAPERS, (paper) => paper.source === source.id) + source.duplicates,
      duplicates: source.duplicates,
      facts: source.kind === "upload" ? ["Most matched to our index", "2 without an abstract"] : source.kind === "pdf" ? ["Titles and abstracts read from the files"] : undefined,
    })),
  );
  const [kind, setKind] = useState<Kind>("upload");
  const [criteria, setCriteria] = useState(() => CRITERIA.map(({ key, text, must }) => ({ key, text, must })));
  const [draft, setDraft] = useState("");
  const [scoring, setScoring] = useState(false);
  const [on, setOn] = useState<string[]>(() => REVIEWERS.map((reviewer) => reviewer.id));
  const [invited, setInvited] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [each, setEach] = useState("2");
  const [rule, setRule] = useState("all");
  const [resolver, setResolver] = useState(YOU.id);
  const [blind, setBlind] = useState("after");
  const [dest, setDest] = useState("new");

  const everyone = [...REVIEWERS, ...MORE_REVIEWERS];
  const people = everyone.filter((reviewer) => reviewer.kind === "person");
  const models = everyone.filter((reviewer) => reviewer.kind === "model");
  const picked = everyone.filter((reviewer) => on.includes(reviewer.id));
  const pickedPeople = picked.filter((reviewer) => reviewer.kind === "person");
  const pickedModels = picked.filter((reviewer) => reviewer.kind === "model");
  const found = sources.reduce((sum, source) => sum + source.found, 0);
  const duplicates = sources.reduce((sum, source) => sum + source.duplicates, 0);
  const papers = found - duplicates;
  const perPaper = each === "all" ? pickedPeople.length : Math.min(Number(each), pickedPeople.length);
  const cost = pickedModels.reduce((sum, model) => sum + model.credits! * papers, 0);
  const toggle = (id: string) => setOn((ids) => (ids.includes(id) ? ids.filter((one) => one !== id) : [...ids, id]));
  const add = (row: Row) => setSources((rows) => (rows.some((one) => one.id === row.id) ? rows : [...rows, row]));
  const addCriterion = () => {
    const text = draft.trim();
    if (!text) return;
    setCriteria((rows) => [...rows, { key: `c${rows.length}-${text.length}`, text, must: false }]);
    setDraft("");
  };

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        {/* Faces fade in as they load, where they would otherwise appear in one frame. */}
        <div className={`contents ${AVATARS_FADE_IN}`}>
        <LibraryPageShell icon={ListChecks} title="New screening" backHref="/screening/mock" backLabel="All screenings">
          <div className="grid @4xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:divide-x @4xl:divide-border-subtle">
            <div className="min-w-0 space-y-8 p-4 sm:p-6">
              <div className="space-y-1">
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this screening" aria-label="Name" maxLength={200} className="w-full rounded-lg bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Decide which papers are in, with your team and any AI models you add as reviewers.</p>
              </div>

              <Zone label="Papers" aside={<Chip><AnimatedNumber value={papers} /> papers after <AnimatedNumber value={duplicates} /> duplicates</Chip>}>
                <div className={LIST}>
                  <AnimatePresence initial={false}>
                    {sources.map((source) => (
                      <motion.div key={source.id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                        <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-inset text-muted-foreground"><source.icon className="size-4" /></span>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="truncate text-sm font-medium">{source.name}</p>
                            <div className="flex flex-wrap gap-1.5">
                              <Chip>{source.found} found</Chip>
                              {source.duplicates ? <Chip>{source.duplicates} already in another source</Chip> : null}
                              {source.facts?.map((fact) => <Chip key={fact} icon={Check}>{fact}</Chip>)}
                            </div>
                          </div>
                          <TooltipHint label="Remove this source">
                            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={`Remove ${source.name}`} onClick={() => setSources((rows) => rows.filter((one) => one.id !== source.id))}><Trash2 /></Button>
                          </TooltipHint>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                <div className="space-y-3 pt-2">
                  <div className="-mx-1 overflow-x-auto px-1 py-0.5"><Segmented label="Add papers from" value={kind} onChange={setKind} options={KINDS} /></div>
                  {kind === "upload" ? (
                    <div className="space-y-3">
                      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border px-6 py-7 text-center">
                        <p className="text-sm font-medium">Drop reference files or PDFs here</p>
                        <p className="text-xs text-muted-foreground">RIS, BibTeX, EndNote, PubMed, Web of Science, CSV and PDF, any number at once</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => UPLOADS.forEach(add)}><Upload />Choose files</Button>
                      </div>
                    </div>
                  ) : (
                    <div className={LIST}>
                      {OFFERED[kind].map((one) => {
                        const id = `${kind}:${one.name}`;
                        const added = sources.some((source) => source.id === id);
                        const Icon = KINDS.find((k) => k.id === kind)!.icon;
                        return (
                          <div key={id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-inset text-muted-foreground"><Icon className="size-4" /></span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{one.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{one.detail}</p>
                            </div>
                            <Chip>{one.found.toLocaleString()} papers</Chip>
                            <Button variant="outline" size="sm" disabled={added} onClick={() => add({ id, icon: Icon, name: one.name, detail: one.detail, found: one.found, duplicates: Math.round(one.found * 0.08) })}>{added ? <><Check />Added</> : <><Plus />Add</>}</Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Zone>

              <Zone
                label="Criteria"
                aside={<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCriteria((rows) => (rows.some((row) => row.key === "g1") ? rows : [...rows, { key: "g1", text: "Is the study published in 2010 or later?", must: false }]))}><AiIcon />Write them from the research question</Button>}
              >
                <div className={LIST}>
                  {criteria.map((criterion, i) => (
                    <div key={criterion.key} className="flex items-center gap-x-3 gap-y-1 px-4 py-2.5 max-sm:flex-wrap">
                      <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <p className="min-w-0 flex-1 text-sm max-sm:basis-[calc(100%-1.75rem)]"><CriterionText text={criterion.text} must={criterion.must} /></p>
                      <TooltipHint label={criterion.must ? "Must be yes for a paper to be included" : "Nice to have: it never excludes a paper"}>
                        <Button variant="ghost" size="sm" aria-pressed={criterion.must} onClick={() => setCriteria((rows) => rows.map((row) => (row.key === criterion.key ? { ...row, must: !row.must } : row)))} className={cn("h-8 shrink-0 gap-1.5 text-xs max-sm:ms-5", criterion.must ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground")}>
                          <Asterisk strokeWidth={2.5} />Must-have
                        </Button>
                      </TooltipHint>
                      <TooltipHint label="Remove this criterion">
                        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="Remove this criterion" onClick={() => setCriteria((rows) => rows.filter((row) => row.key !== criterion.key))}><Trash2 /></Button>
                      </TooltipHint>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCriterion()} placeholder="Add a criterion with a yes or no answer" aria-label="New criterion" className="h-9 flex-1" />
                    <Button variant="outline" size="sm" className="h-9" onClick={addCriterion} disabled={!draft.trim()}><Plus />Add</Button>
                  </div>
                  <div>
                    <button type="button" aria-expanded={scoring} onClick={() => setScoring(!scoring)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">Scoring</span>
                        <span className="block text-xs text-muted-foreground">A paper is included when every must-have criterion is answered yes</span>
                      </span>
                      <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", scoring && "rotate-180")} />
                    </button>
                    <AnimatePresence initial={false}>
                      {scoring ? (
                        <motion.div key="scoring" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                          <div className="space-y-2 px-4 pb-4">
                            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-2 text-xs text-muted-foreground">
                              <span>Points for each answer</span><span className="text-center">Yes</span><span className="text-center">No</span><span className="text-center">Unclear</span>
                            </div>
                            {criteria.map((criterion) => (
                              <div key={criterion.key} className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-2">
                                <span className="truncate text-sm">{criterion.text}</span>
                                {[1, 0, 0].map((points, i) => <Input key={i} type="number" defaultValue={points} aria-label="Points" className="h-8 px-1 text-center text-sm tabular-nums" />)}
                              </div>
                            ))}
                            <p className="pt-1 text-xs text-muted-foreground">Points rank the included papers and set their stars. They never include a paper that fails a must-have criterion.</p>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>
              </Zone>

              <Zone label="Reviewers" aside={<Chip>{pickedPeople.length + invited.length} people and {pickedModels.length} models</Chip>}>
                <div className="grid gap-4 @2xl:grid-cols-2">
                  <div className={cn(LIST, "self-start")}>
                    {people.map((person) => (
                      <ReviewerRow key={person.id} reviewer={person} detail={person.you ? "Starts the screening" : REVIEWERS.includes(person) ? "Member of this workspace" : "Guest from another workspace"} on={on.includes(person.id)} onToggle={() => toggle(person.id)} />
                    ))}
                    {invited.map((address) => (
                      <div key={address} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                        <span className="flex self-start"><EmailAvatar /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{address}</p><p className="text-xs text-muted-foreground">Invited to vote</p></div>
                        <TooltipHint label="Take back the invitation"><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Remove ${address}`} onClick={() => setInvited((all) => all.filter((one) => one !== address))}><Trash2 /></Button></TooltipHint>
                      </div>
                    ))}
                    <form className="flex items-center gap-2 px-4 py-2.5" onSubmit={(event) => { event.preventDefault(); if (email.includes("@")) { setInvited((all) => [...all, email.trim()]); setEmail(""); } }}>
                      <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Invite someone by email" aria-label="Email to invite" className="h-9 flex-1" />
                      <Button type="submit" variant="outline" size="sm" className="h-9" disabled={!email.includes("@")}>Invite</Button>
                    </form>
                  </div>
                  <div className={cn(LIST, "self-start")}>
                    {models.map((model) => (
                      <ReviewerRow key={model.id} reviewer={model} detail={`${model.credits} ${model.credits === 1 ? "credit" : "credits"} a paper`} on={on.includes(model.id)} onToggle={() => toggle(model.id)}>
                        <span className={cn("text-xs tabular-nums", on.includes(model.id) ? "text-foreground" : "text-muted-foreground")}>{(model.credits! * papers).toLocaleString()} credits</span>
                      </ReviewerRow>
                    ))}
                  </div>
                </div>
              </Zone>

              <Zone label="How a paper is decided">
                <div className="space-y-4 rounded-2xl border border-border-subtle p-4">
                  <p className="text-base leading-10">
                    Each paper is read by <b className="font-semibold">{pickedModels.length ? (pickedModels.length === 1 ? "the model" : `all ${pickedModels.length} models`) : "no model"}</b> and{" "}
                    <Pick value={each} onChange={setEach} label="People for each paper" options={[{ id: "1", label: "1 person" }, { id: "2", label: "2 people" }, { id: "all", label: "every person" }]} />. It is settled when{" "}
                    <Pick value={rule} onChange={setRule} label="When a paper is settled" options={[{ id: "all", label: "they all agree" }, { id: "most", label: "most of them agree" }, { id: "one", label: "one of them has decided" }]} />. A split goes to{" "}
                    <Pick value={resolver} onChange={setResolver} label="Who settles a split" options={people.filter((person) => on.includes(person.id)).map((person) => ({ id: person.id, label: person.name }))} />. People see the other votes{" "}
                    <Pick value={blind} onChange={setBlind} label="When people see the other votes" options={[{ id: "after", label: "after they vote" }, { id: "always", label: "at any time" }]} />.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip>{pickedModels.length + perPaper} votes on each paper</Chip>
                    <Chip>{pickedPeople.length ? `About ${Math.ceil((papers * perPaper) / pickedPeople.length).toLocaleString()} papers for each person` : "No person reads a paper"}</Chip>
                    {rule === "one" ? <Chip>The first vote decides, as a screening does today</Chip> : null}
                  </div>
                </div>
              </Zone>

              <Zone label="Included papers go to">
                <div className={LIST} role="radiogroup" aria-label="Where included papers go">
                  <Destination on={dest === "none"} onPick={() => setDest("none")} icon={Ban} name="Nowhere yet" />
                  <Destination on={dest === "new"} onPick={() => setDest("new")} icon={FolderPlus} facts={<Chip>New</Chip>}>
                    <Input defaultValue={name ? `Included in ${name}` : ""} placeholder="Name a new collection" aria-label="Name of the new collection" onFocus={() => setDest("new")} className="h-8 border-transparent bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0" />
                  </Destination>
                  {COLLECTIONS.map((collection) => (
                    <Destination key={collection.id} on={dest === collection.id} onPick={() => setDest(collection.id)} icon={Folder} name={`Add to ${collection.name}`} facts={<Chip>{collection.papers} papers</Chip>} />
                  ))}
                </div>
              </Zone>
            </div>

            {/* What it comes to, in view beside the form. */}
            <aside className="min-w-0 p-4 max-@4xl:border-t max-@4xl:border-border-subtle sm:p-6">
              <div className="space-y-6 @4xl:sticky @4xl:top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+1.5rem)]">
                <div>
                  <p className="text-3xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={papers} /></p>
                  <p className="text-sm text-muted-foreground">papers to screen</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Reviewers</p>
                  <ReviewerStack reviewers={picked} max={8} />
                </div>
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground">Cost</p>
                  <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">People</span><span className="text-muted-foreground">Free</span></div>
                  {pickedModels.map((model) => (
                    <div key={model.id} className="flex items-center gap-2 text-sm">
                      <ReviewerMark reviewer={model} className="size-5" />
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      <span className="tabular-nums"><AnimatedNumber value={model.credits! * papers} /></span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 border-t border-border-subtle pt-2.5 text-sm font-semibold"><Coins className="size-4 text-primary" /><span className="flex-1">Up to</span><span className="tabular-nums"><AnimatedNumber value={cost} /> credits</span></div>
                  <Meter value={BALANCE - cost} max={BALANCE} />
                  <p className="text-xs tabular-nums text-muted-foreground">{BALANCE.toLocaleString()} now, <AnimatedNumber value={BALANCE - cost} /> left after</p>
                </div>
                <div className="space-y-2">
                  <Button asChild className="w-full"><Link href="/screening/mock/edtech">Start screening</Link></Button>
                  <div className="flex flex-wrap gap-1.5"><Chip icon={Gauge}>40 papers at a time</Chip>{pickedModels.length ? null : <Chip>No model, nothing to pay</Chip>}</div>
                </div>
              </div>
            </aside>
          </div>
        </LibraryPageShell>
        </div>
      </PageWrapper>
    </MotionConfig>
  );
}

/** A person or a model that can be a reviewer, switched on or off. */
function ReviewerRow({ reviewer, detail, on, onToggle, children }: { reviewer: Reviewer; detail: string; on: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <div className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors", on && "bg-primary/5")}>
      <ReviewerMark reviewer={reviewer} className="size-9 self-start" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{reviewer.name}</span>{reviewer.you ? <YouTag /> : null}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
      <Switch checked={on} onCheckedChange={onToggle} aria-label={`${reviewer.name} reviews this screening`} />
    </div>
  );
}

/** A choice inside the sentence that says how a paper is decided. */
function Pick({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: Array<{ id: string; label: string }> }) {
  return (
    <Select value={options.some((option) => option.id === value) ? value : options[0]?.id} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="ms-0.5 inline-flex h-8 w-auto gap-1 rounded-lg border-transparent bg-primary/10 px-2.5 align-middle text-base font-semibold text-primary shadow-none hover:bg-primary/15">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Destination({ on, onPick, icon: Icon, name, facts, children }: { on: boolean; onPick: () => void; icon: AppIcon; name?: string; facts?: ReactNode; children?: ReactNode }) {
  return (
    <div role="radio" aria-checked={on} tabIndex={0} onClick={onPick} onKeyDown={(event) => (event.key === " " || event.key === "Enter") && event.target === event.currentTarget && onPick()} className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-muted", on && "bg-primary/5")}>
      <Icon className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1 text-sm font-medium">{children ?? name}</div>
      {facts}
      <PickMark on={on} />
    </div>
  );
}
