"use client";

import { useAction } from "convex/react";
import {
  BookCheck,
  ChevronsUpDown,
  FileText,
  House,
  Inbox,
  type LucideIcon,
  Plus,
  RefreshCw,
  Sparkles,
  Text,
  UserRoundCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { Field } from "../section-card";
import { SectionShell, type SectionProps } from "../section-shell";
import { localPickerSource, type PickerRow, type PickerSource, RemotePickerDialog } from "./remote-picker-dialog";

const LIMITS = SCHEMA_LIMITS.home;

/**
 * What a step shows. A step with a type is drawn from what really happened to the followed publication at that
 * point; a text step is just its name and words.
 */
const STEP_TYPES: Record<HomeStepType, { icon: LucideIcon; label: string; hint: string; fallback: string }> = {
  arrival: { icon: Inbox, label: "Arrival", hint: "Shows the date it arrived for review", fallback: "Submitted" },
  check: { icon: UserRoundCheck, label: "Editor check", hint: "Shows an editor with their photo, and the date", fallback: "Checked by an editor" },
  publication: { icon: BookCheck, label: "Publication", hint: "Shows its DOI and the date it went live", fallback: "Published" },
  text: { icon: Text, label: "Text only", hint: "Shows the name and the words below, nothing else", fallback: "Another step" },
};

/** Radix Select cannot hold an empty value, so "whoever approved it" (an empty editor) is this inside the Select. */
const APPROVER = "approver";

const QUESTION_FALLBACK = "Leave empty to keep the page's own question";

const approvalDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const exampleDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function HomeSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const home = draft.home;
  const team = useTeam(libraryId);
  const generatedQuestions = useHomeQuestions(libraryId);
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
        hint="Steps with a type are filled in from the library's latest reviewed publication."
        action={
          <AddButton
            disabled={home.steps.length >= LIMITS.steps}
            onClick={() =>
              setHome((h) => ({ steps: [...h.steps, { id: newId("st"), type: "text", title: "", text: "", editor: "" }] }))
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
              {() => (
                <PublicationChoice
                  libraryId={libraryId}
                  value={home.followed}
                  onChange={(followed) => setHome(() => ({ followed }))}
                />
              )}
            </Field>
            <TimelinePreview steps={home.steps} team={team ?? []} />
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
                              const Icon = STEP_TYPES[type].icon;
                              return (
                                <SelectItem key={type} value={type} textValue={STEP_TYPES[type].label}>
                                  <span className="flex h-5 items-center self-start" aria-hidden>
                                    <Icon className="text-muted-foreground" />
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
                            {(team ?? []).map((person) => (
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

      <FieldGroup title="Who runs the library" hint="People come from the library's team and pass by in the order set here.">
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
          const day = exampleDate.format(new Date(Date.now() - (steps.length - index) * 86_400_000));
          return (
            <li key={step.id} className="min-w-0">
              <p className="h-4 text-xs font-semibold">{step.type === "text" ? null : day}</p>
              <div className="my-2 flex items-center" aria-hidden>
                <span className="size-2.5 shrink-0 rounded-full border-2 border-primary bg-background" />
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
  return [
    ...data.owners.map((person) => ({ id: person.clerkUserId, name: person.name, imageUrl: person.imageUrl, role: "Owner" })),
    ...data.editors.map((person) => ({ id: person.clerkUserId, name: person.name, imageUrl: person.imageUrl, role: "Editor" })),
    ...data.creators.map((person) => ({ id: person.clerkUserId, name: person.name, imageUrl: person.imageUrl, role: "Creator" })),
  ];
}

/** The questions the page asks in empty slots, as the running library makes them. Empty until it answers. */
function useHomeQuestions(libraryId: Id<"evidenceLibraries">): (string | null)[] {
  const readQuestions = useAction(api.zotero.runtimeReadActions.readHomeQuestions);
  const [questions, setQuestions] = useState<(string | null)[]>([]);
  useEffect(() => {
    let current = true;
    readQuestions({ libraryId })
      .then((result) => current && setQuestions(result.questions))
      // A library that cannot answer leaves the generic placeholder.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [readQuestions, libraryId]);
  return questions;
}

/** The people who pass by in the home page's team band: chosen from the team, in order, each with a title and place. */
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
        <RemotePickerDialog
          mode="multi"
          trigger={
            <Button type="button" variant="outline" size="sm" disabled={value.length >= LIMITS.people}>
              <Plus />
              Add people
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
      </div>
      {value.length === 0 ? (
        <EmptyList>Nobody is shown. Add people from the team.</EmptyList>
      ) : (
        <SortableList ids={value.map((person) => person.id)} onMove={(from, to) => onChange(move(value, from, to))}>
          {value.map((person) => {
            const member = team?.find((each) => each.id === person.id);
            const name = member?.name || person.name;
            // While the team loads nobody counts as removed.
            const removed = team !== undefined && !member;
            return (
              <ListRow
                key={person.id}
                id={person.id}
                removeLabel={`Stop showing ${name}`}
                onRemove={() => onChange(value.filter((each) => each.id !== person.id))}
              >
                <div className="flex items-center gap-3">
                  <IdentityAvatar name={name} imageUrl={member?.imageUrl ?? (person.photo || undefined)} className="size-9 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {removed ? "Removed from the team, so not shown" : member ? `${member.role} on the team` : null}
                    </p>
                  </div>
                </div>
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

type ReviewedPublication = { key: string; title: string; publishedAt: string };

const publicationRow = (publication: ReviewedPublication): PickerRow => ({
  id: publication.key,
  title: publication.title,
  meta: approvalDate.format(new Date(publication.publishedAt)),
});

/** Which publication the journey follows: the latest reviewed one, or one chosen from the library. */
function PublicationChoice({
  libraryId,
  value,
  onChange,
}: {
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
        <Button type="button" variant="outline" className="h-auto w-full justify-start gap-3 bg-background px-3 py-2 text-left font-normal">
          <span className="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground" aria-hidden>
            {shown ? <FileText className="size-4" /> : <RefreshCw className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{shown ? shown.title : "Latest reviewed publication"}</span>
            <span className="block text-xs text-muted-foreground">
              {shown ? (shown.meta ? `Reviewed ${shown.meta}` : "Chosen publication") : "Changes each time an editor approves one"}
            </span>
          </span>
          <ChevronsUpDown className="shrink-0 text-muted-foreground" />
        </Button>
      }
      title="Publication followed"
      description="Choose a reviewed publication to always show, or follow the latest one."
      searchLabel="Search reviewed publications"
      columns={{ title: "Publication", meta: "Reviewed" }}
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
      noneLabel="Latest reviewed publication"
      loadingLabel="Loading reviewed publications"
      failedLabel="The library's publications could not be read."
      emptyLabel="Nothing has been reviewed yet."
      noMatchLabel="No reviewed publication matches."
      notSetUpLabel="The library is not set up yet."
    />
  );
}
