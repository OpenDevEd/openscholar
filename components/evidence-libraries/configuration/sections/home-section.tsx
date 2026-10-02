"use client";

import { useAction } from "convex/react";
import {
  Camera,
  ChevronsUpDown,
  FileText,
  House,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  type HomeDraft,
  type HomeHeadingKey,
  type HomePersonDraft,
  type HomeStepDraft,
  HOME_STEP_TYPES,
  type HomeStepType,
  newId,
  SCHEMA_LIMITS,
} from "@/lib/evidence-libraries/configuration/rules";
import { AddButton, EmptyList, FieldGroup, ListRow, move, SortableList, ToggleRow } from "../fields";
import { RichTextField } from "../rich-text-field";
import { HAND_ENTERED_PREFIX, isHandEntered, publicName, publicPhoto } from "@/lib/evidence-libraries/configuration/home-people";
import { Field } from "../section-card";
import { SectionShell, type SectionProps } from "../section-shell";
import { localPickerSource, type PickerRow, type PickerSource, RemotePickerDialog } from "./remote-picker-dialog";
import { IconPreview, NavbarIconPicker } from "./navbar-icon-picker";
import { PHOTO_ACCEPT, toPersonPhoto } from "../photo-upload";
import { useDropzone } from "react-dropzone";
import { useFileUploads } from "../use-file-uploads";

const LIMITS = SCHEMA_LIMITS.home;

/**
 * What a step shows. Arrival, editor check and publication are drawn from what really happened to the followed
 * publication; search terms, latest update, duplicates and full text are counted from the library's own searches and
 * records; a text step is its name, words and an optional figure. `icon` is the Hugeicon the page puts on a typed
 * step's node when its owner picks none (a text step shows none). `example` stands in for the page's count.
 */
const STEP_TYPES: Record<HomeStepType, { icon: string; label: string; hint: string; fallback: string; dated?: boolean; example?: string }> = {
  arrival: { icon: "InboxDownloadIcon", label: "Arrival", hint: "Shows the date it arrived for review", fallback: "Submitted", dated: true },
  check: { icon: "UserCheck01Icon", label: "Editor check", hint: "Shows an editor with their photo, and the date", fallback: "Checked by an editor", dated: true },
  publication: { icon: "BookOpen01Icon", label: "Publication", hint: "Shows its DOI and the date it went live", fallback: "Published", dated: true },
  search: { icon: "Search01Icon", label: "Search terms", hint: "Counts the words, phrases and topics the library's OpenAlex searches look for", fallback: "Found by search", example: "Search terms" },
  sync: { icon: "RefreshIcon", label: "Latest update", hint: "Counts the records added in the last 30 days", fallback: "Kept up to date", example: "New in the last 30 days" },
  duplicates: { icon: "GitMergeIcon", label: "Duplicates", hint: "Counts the repeated records merged into one", fallback: "Duplicates merged", example: "Repeated records merged" },
  fulltext: { icon: "Pdf01Icon", label: "Full text", hint: "Counts the records with full text", fallback: "Full text added", example: "Records with full text" },
  text: { icon: "TextIcon", label: "Text only", hint: "Shows the name, the words below and a figure you write", fallback: "Another step" },
};


/** Radix Select cannot hold an empty value, so "whoever approved it" (an empty editor) is this inside the Select. */
const APPROVER = "approver";

const QUESTION_FALLBACK = "Leave empty to keep the page's own question";

// In UTC, so the server's render and the browser's agree whatever their time zones.
const approvalDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const exampleDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** The preview's steps end on this fixed day, one day apart, so every render shows the same example dates. */
const EXAMPLE_LAST_DAY = Date.UTC(2026, 2, 12);

export function HomeSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const home = draft.home;
  const team = useTeam(libraryId);
  // A step may name anyone shown: the team, and people written in by hand.
  const editors: TeamPerson[] = [
    ...(team ?? []),
    ...home.people
      .filter((person) => isHandEntered(person.id) && person.name.trim())
      .map((person) => ({ id: person.id, name: person.name.trim(), imageUrl: publicPhoto(person.photo), role: "Added by hand" })),
  ];
  const generatedQuestions = useHomeQuestions(libraryId, draft.features.homePage);
  // Changes read the draft they are applied to, not the one rendered, so an
  // editor's late update cannot undo a newer one.
  const setHome = (change: (home: HomeDraft) => Partial<HomeDraft>) =>
    patch((d) => {
      d.home = { ...d.home, ...change(d.home) };
      return d;
    });
  const setHeading = (key: HomeHeadingKey, value: string) =>
    setHome((h) => ({ headings: { ...h.headings, [key]: value } }));
  const updateStep = (id: string, change: Partial<HomeStepDraft>) =>
    setHome((h) => ({ steps: h.steps.map((step) => (step.id === id ? { ...step, ...change } : step)) }));

  return (
    <SectionShell
      sectionKey="home"
      icon={House}
      description="The page visitors land on at the library's address."
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <ToggleRow
        label="Show a home page"
        hint="When this is off, the library's address opens the publication list."
        checked={draft.features.homePage}
        onChange={(checked) =>
          patch((d) => {
            d.features.homePage = checked;
            return d;
          })
        }
      />

      {/* Like the other switches, off shows nothing more; the answers stay saved. */}
      {draft.features.homePage ? (
        <div className="space-y-6 border-l-2 border-primary/20 pl-4 sm:pl-5">
          <FilledIn draft={draft} />

          <FieldGroup title="Introduction" hint="Shown in the hero, under the library's name and tagline.">
            <RichTextField
              label="What the library is for"
              value={home.intro}
              onChange={(intro) => setHome(() => ({ intro }))}
              maxLength={LIMITS.intro}
              lists={false}
              placeholder="What does this library collect, and for whom?"
            />
          </FieldGroup>

          <FieldGroup
            title="How publications get in"
            hint="Steps with a type are filled in from the publication followed, or counted from the library's searches and records."
            action={
              <AddButton
                disabled={home.steps.length >= LIMITS.steps}
                onClick={() =>
                  setHome((h) => ({ steps: [...h.steps, { id: newId("st"), type: "text", title: "", text: "", editor: "", icon: "", figureValue: "", figureLabel: "" }] }))
                }
              >
                Add step
              </AddButton>
            }
          >
            <HeadingField
              value={home.headings.curation}
              limit={LIMITS.headings.curation}
              fallback="How the library is curated"
              onChange={(value) => setHeading("curation", value)}
            />
            <RichTextField
              label="Statement"
              suffix="Optional"
              value={home.statement}
              onChange={(statement) => setHome(() => ({ statement }))}
              maxLength={LIMITS.statement}
              lists={false}
              minRows={2}
            />
            {home.steps.length === 0 ? (
              <EmptyList>No steps. The section shows the statement on its own.</EmptyList>
            ) : (
              <>
                <Field label="Publication followed" hint="The steps are drawn from what happened to this publication.">
                  {(id) => (
                    <PublicationChoice
                      id={id}
                      libraryId={libraryId}
                      value={home.followed}
                      onChange={(followed) => setHome(() => ({ followed }))}
                    />
                  )}
                </Field>
                <TimelinePreview steps={home.steps} team={editors} />
                <SortableList
                  ids={home.steps.map((step) => step.id)}
                  onMove={(from, to) => setHome((h) => ({ steps: move(h.steps, from, to) }))}
                >
                  {home.steps.map((step, index) => (
                    <ListRow
                      key={step.id}
                      id={step.id}
                      removeLabel="Remove step"
                      onRemove={() => setHome((h) => ({ steps: h.steps.filter((each) => each.id !== step.id) }))}
                    >
                      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                        <Field label={`Step ${index + 1}`}>
                          {(id) => (
                            <Select value={step.type} onValueChange={(type) => updateStep(step.id, { type: type as HomeStepType })}>
                              <SelectTrigger id={id} className="w-full bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {HOME_STEP_TYPES.map((type) => {
                                  return (
                                    <SelectItem key={type} value={type} textValue={STEP_TYPES[type].label}>
                                      <span className="flex h-5 items-center self-start" aria-hidden>
                                        <IconPreview iconId={STEP_TYPES[type].icon} className="size-4 text-muted-foreground" />
                                      </span>
                                      <span className="flex flex-col">
                                        <span>{STEP_TYPES[type].label}</span>
                                        <span className="text-xs text-muted-foreground in-data-[slot=select-value]:hidden">
                                          {STEP_TYPES[type].hint}
                                        </span>
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )}
                        </Field>
                        <Field label="Name" counter={`${step.title.length} / ${LIMITS.stepTitle}`}>
                          {(id) => (
                            <Input
                              id={id}
                              className="bg-background"
                              maxLength={LIMITS.stepTitle}
                              placeholder={STEP_TYPES[step.type].fallback}
                              value={step.title}
                              onChange={(event) => updateStep(step.id, { title: event.target.value })}
                            />
                          )}
                        </Field>
                      </div>
                      {step.type === "check" ? (
                        <Field label="Editor shown">
                          {(id) => (
                            <Select
                              value={step.editor || APPROVER}
                              onValueChange={(editor) => updateStep(step.id, { editor: editor === APPROVER ? "" : editor })}
                            >
                              <SelectTrigger id={id} className="w-full bg-background sm:w-72">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={APPROVER}>Whoever approved it</SelectItem>
                                {editors.map((person) => (
                                  <SelectItem key={person.id} value={person.id}>
                                    <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-5" />
                                    {person.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </Field>
                      ) : null}
                      <StepLook step={step} onChange={(change) => updateStep(step.id, change)} />
                      <Field label="What happens" suffix="Optional" counter={`${step.text.length} / ${LIMITS.stepText}`}>
                        {(id) => (
                          <Textarea
                            id={id}
                            className="bg-background"
                            rows={2}
                            maxLength={LIMITS.stepText}
                            value={step.text}
                            onChange={(event) => updateStep(step.id, { text: event.target.value })}
                          />
                        )}
                      </Field>
                    </ListRow>
                  ))}
                </SortableList>
              </>
            )}
          </FieldGroup>

          <FieldGroup title="Who runs the library" hint="People from the library's team, or added by hand, pass by in the order set here.">
            <HeadingField
              value={home.headings.team}
              limit={LIMITS.headings.team}
              fallback="Who is behind it"
              onChange={(value) => setHeading("team", value)}
            />
            <RichTextField
              label="About the team"
              suffix="Optional"
              value={home.team}
              onChange={(team) => setHome(() => ({ team }))}
              maxLength={LIMITS.team}
              lists={false}
              minRows={2}
            />
            <EditorsField team={team} value={home.people} onChange={(people) => setHome(() => ({ people }))} />
            <HeadingField
              value={home.headings.involvement}
              limit={LIMITS.headings.involvement}
              fallback="Get involved"
              hint="Used instead when there is no team sentence."
              onChange={(value) => setHeading("involvement", value)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow
                label="Suggest a publication"
                hint={draft.contact.email ? `Opens an email to ${draft.contact.email}` : "Needs a contact email"}
                checked={home.involvement.suggestions && Boolean(draft.contact.email)}
                disabled={!draft.contact.email}
                onChange={(suggestions) => setHome((h) => ({ involvement: { ...h.involvement, suggestions } }))}
              />
              <ToggleRow
                label="Join as an editor"
                hint={draft.contact.email ? `Opens an email to ${draft.contact.email}` : "Needs a contact email"}
                checked={home.involvement.editors && Boolean(draft.contact.email)}
                disabled={!draft.contact.email}
                onChange={(editors) => setHome((h) => ({ involvement: { ...h.involvement, editors } }))}
              />
            </div>
          </FieldGroup>

          <FieldGroup
            title="Ask the library"
            hint={
              draft.features.ai
                ? "Typed into the question box one after another. An empty box keeps the question made from the library's topics."
                : "Shown when AI answers are on in Features. An empty box keeps the question made from the library's topics."
            }
          >
            <div className="space-y-2">
              {home.questions.map((question, index) => (
                <Field
                  key={index}
                  label={`Example question ${index + 1}`}
                  suffix="Optional"
                  counter={`${question.length} / ${LIMITS.question}`}
                >
                  {(id) => (
                    <div className="relative">
                      <Sparkles
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        id={id}
                        className="bg-background pl-9"
                        maxLength={LIMITS.question}
                        placeholder={generatedQuestions[index] || QUESTION_FALLBACK}
                        value={question}
                        onChange={(event) =>
                          setHome((h) => ({ questions: h.questions.map((each, at) => (at === index ? event.target.value : each)) }))
                        }
                      />
                    </div>
                  )}
                </Field>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup title="Using and citing" hint="Shown beside the citation of the library, which is made from its name and address.">
            <HeadingField
              value={home.extra.title}
              limit={LIMITS.extraTitle}
              fallback="Using and citing the library"
              onChange={(title) => setHome((h) => ({ extra: { ...h.extra, title } }))}
            />
            <RichTextField
              label="Licence and reuse"
              suffix="Optional"
              value={home.extra.text}
              onChange={(text) => setHome((h) => ({ extra: { ...h.extra, text } }))}
              maxLength={LIMITS.extra}
              placeholder="How may people reuse what they find here?"
            />
          </FieldGroup>
        </div>
      ) : null}
    </SectionShell>
  );
}

function HeadingField({
  value,
  limit,
  fallback,
  hint,
  onChange,
}: {
  value: string;
  limit: number;
  fallback: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Heading" suffix="Optional" hint={hint} counter={`${value.length} / ${limit}`}>
      {(id) => (
        <Input
          id={id}
          className="bg-background"
          maxLength={limit}
          placeholder={fallback}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** A step's icon and, on a text step, the figure its owner writes. */
function StepLook({ step, onChange }: { step: HomeStepDraft; onChange: (change: Partial<HomeStepDraft>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <Field label="Icon" suffix="Optional">
        {(id) => (
          <NavbarIconPicker
            id={id}
            value={step.icon}
            onChange={(icon) => onChange({ icon })}
            placeholder={step.type === "text" ? "No icon" : "The type's own icon"}
          />
        )}
      </Field>
      {step.type === "text" ? (
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Field label="Figure" suffix="Optional" counter={`${step.figureValue.length} / ${LIMITS.figureValue}`}>
            {(id) => (
              <Input
                id={id}
                className="bg-background"
                maxLength={LIMITS.figureValue}
                placeholder="25,000"
                value={step.figureValue}
                onChange={(event) => onChange({ figureValue: event.target.value })}
              />
            )}
          </Field>
          <Field label="What it counts" counter={`${step.figureLabel.length} / ${LIMITS.figureLabel}`}>
            {(id) => (
              <Input
                id={id}
                className="bg-background"
                maxLength={LIMITS.figureLabel}
                placeholder="AI screening judgements"
                value={step.figureLabel}
                onChange={(event) => onChange({ figureLabel: event.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** A step's node in the preview: its icon in a disc, as on the page, or a plain ring. */
function PreviewNode({ step }: { step: HomeStepDraft }) {
  const icon = step.icon || (step.type === "text" ? "" : STEP_TYPES[step.type].icon);
  if (!icon) return <span className="size-2.5 shrink-0 rounded-full border-2 border-primary bg-background" />;
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
      <IconPreview iconId={icon} className="size-3.5" />
    </span>
  );
}

/**
 * The steps as the page draws them: dates above one line with a node per step, then each step's name and what its
 * type fills in. The dates are examples; with "whoever approved it", the example editor is the first person on the team.
 */
function TimelinePreview({ steps, team }: { steps: HomeStepDraft[]; team: TeamPerson[] }) {
  return (
    <figure className="rounded-lg bg-muted/40 p-4" aria-label="How the steps look on the page">
      <figcaption className="mb-4 text-xs text-muted-foreground">On the page</figcaption>
      <ol className="grid gap-x-6 gap-y-5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => {
          const editor = team.find((person) => person.id === step.editor) ?? team[0];
          const day = exampleDate.format(new Date(EXAMPLE_LAST_DAY - (steps.length - 1 - index) * 86_400_000));
          return (
            <li key={step.id} className="min-w-0">
              <p className="h-4 text-xs font-semibold">{STEP_TYPES[step.type].dated ? day : null}</p>
              <div className="my-2 flex items-center" aria-hidden>
                <PreviewNode step={step} />
                <span className="h-px flex-1 bg-primary/40" />
              </div>
              <p className="truncate text-sm font-semibold">{step.title || STEP_TYPES[step.type].fallback}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                {step.type === "arrival" ? <>Arrived for review</> : null}
                {step.type === "check" ? (
                  <span className="flex items-center gap-1.5">
                    <IdentityAvatar name={editor?.name ?? "Editor"} imageUrl={editor?.imageUrl} className="size-5 shrink-0" />
                    <span className="truncate">{editor?.name ?? "An editor"}</span>
                  </span>
                ) : null}
                {step.type === "publication" ? <span className="underline underline-offset-2">DOI</span> : null}
                {STEP_TYPES[step.type].example ?? null}
                {step.type === "text" && step.figureValue ? (
                  <span className="block">
                    <span className="block text-base font-semibold text-foreground">{step.figureValue}</span>
                    {step.figureLabel}
                  </span>
                ) : null}
                {step.type === "text" ? <span className="line-clamp-2">{step.text}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/** What the page shows from settings made elsewhere, each with the card that changes it. */
function FilledIn({ draft }: { draft: SectionProps["draft"] }) {
  const rows: { label: string; value: ReactNode; section: string; card: string }[] = [
    { label: "Tagline", value: draft.identity.tagline || <Missing />, section: "identity", card: "Identity" },
    { label: "Contact email", value: draft.contact.email || <Missing />, section: "contact", card: "Contact" },
    { label: "Takedown form", value: draft.email.takedownRecipient ? "Linked" : <Missing>Off</Missing>, section: "contact", card: "Contact" },
  ];
  return (
    <FieldGroup title="Filled in for you" hint="Newest publications, the most cited, digests and the latest review come from the library itself.">
      <dl className="divide-y divide-border/50 rounded-lg border border-border/50">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-4 px-3 py-2.5 text-sm">
            <dt className="w-32 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate">{row.value}</dd>
            <a href={`#sec-${row.section}`} className="shrink-0 text-xs font-medium text-primary hover:underline">
              Edit in {row.card}
            </a>
          </div>
        ))}
      </dl>
    </FieldGroup>
  );
}

function Missing({ children = "Not set" }: { children?: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

type TeamPerson = { id: string; name: string; imageUrl?: string; role: string };

/** The library's team as the Team card has it: owners, editors and creators, with their photos. Undefined while it loads. */
function useTeam(libraryId: Id<"evidenceLibraries">): TeamPerson[] | undefined {
  const { data } = useProtectedQuery(api.evidenceLibraries.queries.listTeam, { libraryId });
  if (!data) return undefined;
  // Only people the page can name, as it will name them; an email is never shown instead of a name.
  const shown = (people: typeof data.owners, role: string) =>
    people.flatMap((person) => {
      const name = publicName(person.name);
      return name ? [{ id: person.clerkUserId, name, imageUrl: publicPhoto(person.imageUrl), role }] : [];
    });
  return [...shown(data.owners, "Owner"), ...shown(data.editors, "Editor"), ...shown(data.creators, "Creator")];
}

/** The questions the page asks in empty slots, as the running library makes them. Empty until it answers; not asked while the home page is off. */
function useHomeQuestions(libraryId: Id<"evidenceLibraries">, enabled: boolean): (string | null)[] {
  const readQuestions = useAction(api.zotero.runtimeReadActions.readHomeQuestions);
  const [questions, setQuestions] = useState<(string | null)[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    readQuestions({ libraryId })
      .then((result) => current && setQuestions(result.questions))
      // A library that cannot answer leaves the generic placeholder.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [readQuestions, libraryId, enabled]);
  return questions;
}

/**
 * The people who pass by in the home page's team band, in order, each with a title and place: chosen from the team,
 * with the name and photo of their account, or written in by hand for anyone without one.
 */
function EditorsField({
  team,
  value,
  onChange,
}: {
  team: TeamPerson[] | undefined;
  value: HomePersonDraft[];
  onChange: (value: HomePersonDraft[]) => void;
}) {
  const update = (id: string, change: Partial<HomePersonDraft>) =>
    onChange(value.map((person) => (person.id === id ? { ...person, ...change } : person)));
  const rows: PickerRow[] = (team ?? []).map((person) => ({ id: person.id, title: person.name, meta: person.role }));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">People shown</p>
        <div className="flex flex-wrap items-center gap-2">
        <RemotePickerDialog
          mode="multi"
          trigger={
            <Button type="button" variant="outline" size="sm" disabled={value.length >= LIMITS.people}>
              <Plus />
              Add from the team
            </Button>
          }
          title="Add people from the team"
          description="Everyone on the library's team, with the photo from their account."
          searchLabel="Search the team"
          columns={{ title: "Name", meta: "Role" }}
          source={localPickerSource(rows)}
          renderLeading={(row) => (
            <IdentityAvatar name={row.title} imageUrl={team?.find((person) => person.id === row.id)?.imageUrl} className="size-7" />
          )}
          usedIds={value.map((person) => person.id)}
          usedLabel="Shown"
          confirmLabel={(count) => (count === 1 ? "Add 1 person" : `Add ${count} people`)}
          onConfirm={(picked) =>
            onChange(
              [
                ...value,
                ...picked.map((row) => ({
                  id: row.id,
                  name: row.title,
                  photo: team?.find((person) => person.id === row.id)?.imageUrl ?? "",
                  title: "",
                  location: "",
                })),
              ].slice(0, LIMITS.people),
            )
          }
          loadingLabel="Loading the team"
          failedLabel="The team could not be read."
          emptyLabel="Nobody is on the team yet."
          noMatchLabel="Nobody on the team matches."
          notSetUpLabel="Nobody is on the team yet."
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.length >= LIMITS.people}
          onClick={() => onChange([...value, { id: newId(HAND_ENTERED_PREFIX), name: "", photo: "", title: "", location: "" }])}
        >
          <Plus />
          Add someone
        </Button>
        </div>
      </div>
      {value.length === 0 ? (
        <EmptyList>Nobody is shown. Add people from the team, or add someone who has no account.</EmptyList>
      ) : (
        <SortableList ids={value.map((person) => person.id)} onMove={(from, to) => onChange(move(value, from, to))}>
          {value.map((person) => {
            const byHand = isHandEntered(person.id);
            const member = byHand ? undefined : team?.find((each) => each.id === person.id);
            const name = member?.name || person.name || "Someone new";
            // While the team loads nobody counts as removed.
            const removed = !byHand && team !== undefined && !member;
            return (
              <ListRow
                key={person.id}
                id={person.id}
                removeLabel={`Stop showing ${name}`}
                onRemove={() => onChange(value.filter((each) => each.id !== person.id))}
              >
                {byHand ? (
                  <PhotoPerson name={name} photo={person.photo} onChange={(photo) => update(person.id, { photo })} />
                ) : (
                  <div className="flex items-center gap-3">
                    <IdentityAvatar name={name} imageUrl={member?.imageUrl} className="size-9 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {removed ? "Removed from the team, so not shown" : member ? `${member.role} on the team` : null}
                      </p>
                    </div>
                  </div>
                )}
                {byHand ? (
                  <div className="grid gap-3">
                    <Field label="Name" counter={`${person.name.length} / ${LIMITS.personName}`}>
                      {(id) => (
                        <Input
                          id={id}
                          className="bg-background"
                          maxLength={LIMITS.personName}
                          placeholder="Amina Yusuf"
                          value={person.name}
                          onChange={(event) => update(person.id, { name: event.target.value })}
                        />
                      )}
                    </Field>

                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title" suffix="Optional" counter={`${person.title.length} / ${LIMITS.personTitle}`}>
                    {(id) => (
                      <Input
                        id={id}
                        className="bg-background"
                        maxLength={LIMITS.personTitle}
                        placeholder="Editor in chief"
                        value={person.title}
                        onChange={(event) => update(person.id, { title: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Location" suffix="Optional" counter={`${person.location.length} / ${LIMITS.personLocation}`}>
                    {(id) => (
                      <Input
                        id={id}
                        className="bg-background"
                        maxLength={LIMITS.personLocation}
                        placeholder="Nairobi, Kenya"
                        value={person.location}
                        onChange={(event) => update(person.id, { location: event.target.value })}
                      />
                    )}
                  </Field>
                </div>
              </ListRow>
            );
          })}
        </SortableList>
      )}
    </div>
  );
}

/**
 * A person written in by hand, as their row opens: their picture is where their photo is chosen. Click it, press
 * Enter on it or drop an image on it; the photo is cropped to a square and made small before it is stored.
 */
function PhotoPerson({ name, photo, onChange }: { name: string; photo: string; onChange: (photo: string) => void }) {
  const { uploadFile } = useFileUploads();
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function upload(files: File[]) {
    const file = files[0];
    if (!file) return;
    setFailed(false);
    setUploading(true);
    try {
      const result = await uploadFile("image", await toPersonPhoto(file));
      if (result.ok && result.kind === "file") onChange(result.url);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  }
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: PHOTO_ACCEPT,
    multiple: false,
    disabled: uploading,
    onDrop: upload,
    onDropRejected: () => setFailed(true),
  });
  const label = photo ? `Change the photo of ${name}` : `Add a photo of ${name}`;
  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" {...getRootProps({ role: "button" })} aria-label={label} className="group relative block rounded-full outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <input {...getInputProps()} />
              <IdentityAvatar name={name} imageUrl={publicPhoto(photo)} className="size-12" />
              <span
                aria-hidden
                data-active={isDragActive || uploading || undefined}
                className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 data-[active]:opacity-100 motion-reduce:transition-none"
              >
                {uploading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Camera className="size-4" />}
              </span>
              {/* Without a photo, a pen says the picture can be changed before anyone hovers it. */}
              {photo ? null : (
                <span aria-hidden className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm">
                  <Pencil className="size-3" />
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        {photo && !uploading ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Remove the photo of ${name}`}
                onClick={() => onChange("")}
                className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Remove the photo</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{photo ? "Added by hand" : "Added by hand. Click the picture to add a photo."}</p>
        {failed ? <p role="alert" className="text-xs text-destructive">That photo could not be used. Try a JPEG, PNG or WebP image.</p> : null}
      </div>
    </div>
  );
}

type ReviewedPublication = { key: string; title: string; publishedAt: string; reviewed: boolean };

const publicationRow = (publication: ReviewedPublication): PickerRow => ({
  id: publication.key,
  title: publication.title,
  meta: `${publication.reviewed ? "Reviewed" : "Added"} ${approvalDate.format(new Date(publication.publishedAt))}`,
});

/** Which publication the journey follows: the latest one, or one with a PDF chosen from the library, reviewed or not. */
function PublicationChoice({
  id,
  libraryId,
  value,
  onChange,
}: {
  /** The field's id, so its label names and opens the picker. */
  id: string;
  libraryId: Id<"evidenceLibraries">;
  value: string;
  onChange: (value: string) => void;
}) {
  const listReviewed = useAction(api.zotero.runtimeReadActions.listReviewedPublications);
  const [chosen, setChosen] = useState<PickerRow | null>(null);
  // A saved choice is only a key, so its title is asked for once.
  useEffect(() => {
    if (!value || chosen?.id === value) return;
    let current = true;
    listReviewed({ libraryId, ids: [value] })
      .then((page) => {
        const found = page.items.find((item) => item.key === value);
        if (current && found) setChosen(publicationRow(found));
      })
      // The key stands in for the title when the library cannot answer.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [listReviewed, libraryId, value, chosen?.id]);
  const shown = value ? (chosen?.id === value ? chosen : { id: value, title: value }) : null;
  const source: PickerSource = async ({ query, cursor }) => {
    const page = await listReviewed({ libraryId, query: query || undefined, cursor: cursor ?? undefined });
    return { reason: page.reason, items: page.items.map(publicationRow), nextCursor: page.nextCursor };
  };
  return (
    <RemotePickerDialog
      mode="single"
      trigger={
        <Button id={id} type="button" variant="outline" className="h-auto w-full justify-start gap-3 bg-background px-3 py-2 text-left font-normal">
          <span className="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground" aria-hidden>
            {shown ? <FileText className="size-4" /> : <RefreshCw className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{shown ? shown.title : "Latest publication"}</span>
            <span className="block text-xs text-muted-foreground">
              {shown ? (shown.meta ?? "Chosen publication") : "The latest an editor approved, or the latest added if none were reviewed"}
            </span>
          </span>
          <ChevronsUpDown className="shrink-0 text-muted-foreground" />
        </Button>
      }
      title="Publication followed"
      description="Choose a publication with a PDF to always show, or follow the latest one."
      searchLabel="Search publications"
      columns={{ title: "Publication", meta: "Date" }}
      source={source}
      renderLeading={() => (
        <span className="grid h-10 w-7 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground" aria-hidden>
          <FileText className="size-4" />
        </span>
      )}
      value={value}
      onChoose={(row) => {
        setChosen(row);
        onChange(row?.id ?? "");
      }}
      noneLabel="Latest publication"
      loadingLabel="Loading publications"
      failedLabel="The library's publications could not be read."
      emptyLabel="No publication has a PDF yet."
      noMatchLabel="No publication matches."
      notSetUpLabel="The library is not set up yet."
    />
  );
}
