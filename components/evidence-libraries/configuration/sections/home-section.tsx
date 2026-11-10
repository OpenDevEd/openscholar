"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "convex/react";
import {
  Camera,
  ChevronsUpDown,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X,
  HomeIcon,
  AiIcon,
} from "@/components/icons";
import { useCallback, type ReactNode, useEffect, useState } from "react";
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
import { useReadOnly } from "../read-only";
import { localPickerSource, PICKER_PAGE_SIZE, type PickerRow, type PickerSource, RemotePickerDialog } from "./remote-picker-dialog";
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
const STEP_TYPES = {
  arrival: { icon: "InboxDownloadIcon", label: "stepTypes.arrival.label", hint: "stepTypes.arrival.hint", fallback: "stepTypes.arrival.fallback", dated: true },
  check: { icon: "UserCheck01Icon", label: "stepTypes.check.label", hint: "stepTypes.check.hint", fallback: "stepTypes.check.fallback", dated: true },
  publication: { icon: "BookOpen01Icon", label: "stepTypes.publication.label", hint: "stepTypes.publication.hint", fallback: "stepTypes.publication.fallback", dated: true },
  search: { icon: "Search01Icon", label: "stepTypes.search.label", hint: "stepTypes.search.hint", fallback: "stepTypes.search.fallback", example: "stepTypes.search.example" },
  sync: { icon: "RefreshIcon", label: "stepTypes.sync.label", hint: "stepTypes.sync.hint", fallback: "stepTypes.sync.fallback", example: "stepTypes.sync.example" },
  duplicates: { icon: "GitMergeIcon", label: "stepTypes.duplicates.label", hint: "stepTypes.duplicates.hint", fallback: "stepTypes.duplicates.fallback", example: "stepTypes.duplicates.example" },
  fulltext: { icon: "Pdf01Icon", label: "stepTypes.fulltext.label", hint: "stepTypes.fulltext.hint", fallback: "stepTypes.fulltext.fallback", example: "stepTypes.fulltext.example" },
  text: { icon: "TextIcon", label: "stepTypes.text.label", hint: "stepTypes.text.hint", fallback: "stepTypes.text.fallback" },
} as const satisfies Record<HomeStepType, { icon: string; label: string; hint: string; fallback: string; dated?: boolean; example?: string }>;


/** Radix Select cannot hold an empty value, so "whoever approved it" (an empty editor) is this inside the Select. */
const APPROVER = "approver";

// In UTC, so the server's render and the browser's agree whatever their time zones.
const APPROVAL_DATE = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;
const EXAMPLE_DATE = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } as const;
/** The preview's steps end on this fixed day, one day apart, so every render shows the same example dates. */
const EXAMPLE_LAST_DAY = Date.UTC(2026, 2, 12);

export function HomeSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
  const home = draft.home;
  const team = useTeam(libraryId);
  // A step may name anyone shown: the team, and people written in by hand.
  const editors: TeamPerson[] = [
    ...(team ?? []),
    ...home.people
      .filter((person) => isHandEntered(person.id) && person.name.trim())
      .map((person) => ({ id: person.id, name: person.name.trim(), imageUrl: publicPhoto(person.photo), role: tLabels("addedByHand") })),
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
      icon={HomeIcon}
      description={t("thePageVisitorsLandOnAt")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <ToggleRow
        label={t("showAHomePage")}
        hint={t("whenThisIsOffTheLibrary")}
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
        <div className="space-y-6 border-s-2 border-primary/20 ps-4 sm:ps-5">
          <FilledIn draft={draft} />

          <FieldGroup title={t("introduction")} hint={t("shownInTheHeroUnderThe")}>
            <RichTextField
              label={t("whatTheLibraryIsFor")}
              value={home.intro}
              onChange={(intro) => setHome(() => ({ intro }))}
              maxLength={LIMITS.intro}
              lists={false}
              placeholder={t("whatDoesThisLibraryCollectAnd")}
            />
          </FieldGroup>

          <FieldGroup
            title={t("howPublicationsGetIn")}
            hint={t("stepsWithATypeAreFilled")}
            action={
              <AddButton
                disabled={home.steps.length >= LIMITS.steps}
                onClick={() =>
                  setHome((h) => ({ steps: [...h.steps, { id: newId("st"), type: "text", title: "", text: "", editor: "", icon: "", figureValue: "", figureLabel: "" }] }))
                }
              >
                {t("addStep")}
              </AddButton>
            }
          >
            <HeadingField
              value={home.headings.curation}
              limit={LIMITS.headings.curation}
              fallback={tLabels("howTheLibraryIsCurated")}
              onChange={(value) => setHeading("curation", value)}
            />
            <RichTextField
              label={t("statement")}
              suffix={tLabels("optional")}
              value={home.statement}
              onChange={(statement) => setHome(() => ({ statement }))}
              maxLength={LIMITS.statement}
              lists={false}
              minRows={2}
            />
            {home.steps.length === 0 ? (
              <EmptyList>{t("noStepsTheSectionShowsThe")}</EmptyList>
            ) : (
              <>
                <Field label={t("publicationFollowed")} hint={t("theStepsAreDrawnFromWhat")}>
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
                      removeLabel={tLabels("removeStep")}
                      onRemove={() => setHome((h) => ({ steps: h.steps.filter((each) => each.id !== step.id) }))}
                    >
                      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                        <Field label={t("step", { value: index + 1 })}>
                          {(id) => (
                            <Select value={step.type} onValueChange={(type) => updateStep(step.id, { type: type as HomeStepType })}>
                              <SelectTrigger id={id} className="w-full bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {HOME_STEP_TYPES.map((type) => {
                                  return (
                                    <SelectItem key={type} value={type} textValue={t(STEP_TYPES[type].label)}>
                                      <span className="flex h-5 items-center self-start" aria-hidden>
                                        <IconPreview iconId={STEP_TYPES[type].icon} className="size-4 text-muted-foreground" />
                                      </span>
                                      <span className="flex flex-col">
                                        <span>{t(STEP_TYPES[type].label)}</span>
                                        <span className="text-xs text-muted-foreground in-data-[slot=select-value]:hidden">
                                          {t(STEP_TYPES[type].hint)}
                                        </span>
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )}
                        </Field>
                        <Field label={t("name")} counter={`${step.title.length} / ${LIMITS.stepTitle}`}>
                          {(id) => (
                            <Input
                              id={id}
                              className="bg-background"
                              maxLength={LIMITS.stepTitle}
                              placeholder={t(STEP_TYPES[step.type].fallback)}
                              value={step.title}
                              onChange={(event) => updateStep(step.id, { title: event.target.value })}
                            />
                          )}
                        </Field>
                      </div>
                      {step.type === "check" ? (
                        <Field label={t("editorShown")}>
                          {(id) => (
                            <Select
                              value={step.editor || APPROVER}
                              onValueChange={(editor) => updateStep(step.id, { editor: editor === APPROVER ? "" : editor })}
                            >
                              <SelectTrigger id={id} className="w-full bg-background sm:w-72">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={APPROVER}>{t("whoeverApprovedIt")}</SelectItem>
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
                      <Field label={t("whatHappens")} suffix={tLabels("optional")} counter={`${step.text.length} / ${LIMITS.stepText}`}>
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

          <FieldGroup title={t("whoRunsTheLibrary")} hint={t("peopleFromTheLibrarySTeam")}>
            <HeadingField
              value={home.headings.team}
              limit={LIMITS.headings.team}
              fallback={tLabels("whoIsBehindIt")}
              onChange={(value) => setHeading("team", value)}
            />
            <RichTextField
              label={t("aboutTheTeam")}
              suffix={tLabels("optional")}
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
              fallback={tLabels("getInvolved")}
              hint={t("usedInsteadWhenThereIsNo")}
              onChange={(value) => setHeading("involvement", value)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {/* The site's own buttons: Suggest papers opens its dialog, which needs reader accounts to sign in with. */}
              <ToggleRow
                label={t("suggestPapers")}
                hint={draft.features.readerAccounts ? t("suggestPapersHint") : t("needsReaderAccounts")}
                checked={home.involvement.suggestions && draft.features.readerAccounts}
                disabled={!draft.features.readerAccounts}
                onChange={(suggestions) => setHome((h) => ({ involvement: { ...h.involvement, suggestions } }))}
              />
              {/* Join this team opens applying on Openscholar; the site hides it while the community takes no applications. */}
              <ToggleRow
                label={t("joinThisTeam")}
                hint={t("joinThisTeamHint")}
                checked={home.involvement.editors}
                onChange={(editors) => setHome((h) => ({ involvement: { ...h.involvement, editors } }))}
              />
            </div>
          </FieldGroup>

          <FieldGroup
            title={t("askTheLibrary")}
            hint={
              draft.features.ai
                ? t("typedIntoTheQuestionBoxOne")
                : t("shownWhenAiAnswersAreOn")
            }
          >
            <div className="space-y-2">
              {home.questions.map((question, index) => (
                <Field
                  key={index}
                  label={t("exampleQuestion", { value: index + 1 })}
                  suffix={tLabels("optional")}
                  counter={`${question.length} / ${LIMITS.question}`}
                >
                  {(id) => (
                    <div className="relative">
                      <AiIcon
                        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
                      />
                      <Input
                        id={id}
                        className="bg-background ps-9"
                        maxLength={LIMITS.question}
                        placeholder={generatedQuestions[index] || t("questionFallback")}
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

          <FieldGroup title={t("usingAndCiting")} hint={t("shownBesideTheCitationOfThe")}>
            <HeadingField
              value={home.extra.title}
              limit={LIMITS.extraTitle}
              fallback={tLabels("usingAndCitingTheLibrary")}
              onChange={(title) => setHome((h) => ({ extra: { ...h.extra, title } }))}
            />
            <RichTextField
              label={t("licenceAndReuse")}
              suffix={tLabels("optional")}
              value={home.extra.text}
              onChange={(text) => setHome((h) => ({ extra: { ...h.extra, text } }))}
              maxLength={LIMITS.extra}
              placeholder={t("howMayPeopleReuseWhatThey")}
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
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
  return (
    <Field label={t("heading")} suffix={tLabels("optional")} hint={hint} counter={`${value.length} / ${limit}`}>
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
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
  return (
    <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <Field label={t("icon")} suffix={tLabels("optional")}>
        {(id) => (
          <NavbarIconPicker
            id={id}
            value={step.icon}
            onChange={(icon) => onChange({ icon })}
            placeholder={step.type === "text" ? t("noIcon") : t("theTypeSOwnIcon")}
          />
        )}
      </Field>
      {step.type === "text" ? (
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Field label={t("figure")} suffix={tLabels("optional")} counter={`${step.figureValue.length} / ${LIMITS.figureValue}`}>
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
          <Field label={t("whatItCounts")} counter={`${step.figureLabel.length} / ${LIMITS.figureLabel}`}>
            {(id) => (
              <Input
                id={id}
                className="bg-background"
                maxLength={LIMITS.figureLabel}
                placeholder={t("aiScreeningJudgements")}
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
  const t = useTranslations("libraryHomeSettings");
  const format = useFormatter();
  return (
    <figure className="rounded-lg bg-inset p-4" aria-label={t("howTheStepsLookOnThe")}>
      <figcaption className="mb-4 text-xs text-muted-foreground">{t("onThePage")}</figcaption>
      <ol className="grid gap-x-6 gap-y-5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => {
          const stepType = STEP_TYPES[step.type];
          const editor = team.find((person) => person.id === step.editor) ?? team[0];
          const day = format.dateTime(new Date(EXAMPLE_LAST_DAY - (steps.length - 1 - index) * 86_400_000), EXAMPLE_DATE);
          return (
            <li key={step.id} className="min-w-0">
              <p className="h-4 text-xs font-semibold">{"dated" in stepType ? day : null}</p>
              <div className="my-2 flex items-center" aria-hidden>
                <PreviewNode step={step} />
                <span className="h-px flex-1 bg-primary/40" />
              </div>
              <p className="truncate text-sm font-semibold">{step.title || t(stepType.fallback)}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                {step.type === "arrival" ? <>{t("arrivedForReview")}</> : null}
                {step.type === "check" ? (
                  <span className="flex items-center gap-1.5">
                    <IdentityAvatar name={editor?.name ?? "Editor"} imageUrl={editor?.imageUrl} className="size-5 shrink-0" />
                    <span className="truncate">{editor?.name ?? t("anEditor")}</span>
                  </span>
                ) : null}
                {step.type === "publication" ? <span className="underline underline-offset-2">DOI</span> : null}
                {"example" in stepType ? t(stepType.example) : null}
                {step.type === "text" && step.figureValue.trim() && step.figureLabel.trim() ? (
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
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
  const rows: { label: string; value: ReactNode; section: string; card: string }[] = [
    { label: t("tagline"), value: draft.identity.tagline || <Missing />, section: "identity", card: tLabels("identity") },
    { label: t("contactEmail"), value: draft.contact.email || <Missing />, section: "contact", card: tLabels("contact") },
    { label: t("takedownForm"), value: draft.email.takedownRecipient ? tLabels("linked") : <Missing>{t("off")}</Missing>, section: "contact", card: tLabels("contact") },
  ];
  return (
    <FieldGroup title={t("filledInForYou")} hint={t("newestPublicationsTheMostCitedDigests")}>
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-4 px-3 py-2.5 text-sm">
            <dt className="w-32 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate">{row.value}</dd>
            <a href={`#sec-${row.section}`} className="shrink-0 text-xs font-medium text-primary hover:underline">{t("editIn", { card: row.card })}
            </a>
          </div>
        ))}
      </dl>
    </FieldGroup>
  );
}

function Missing({ children }: { children?: ReactNode }) {
  const tLabels = useTranslations("libraryHomeSettings");
  return <span className="text-muted-foreground">{children ?? tLabels("notSet")}</span>;
}

type TeamPerson = { id: string; name: string; imageUrl?: string; role: string };

/** The library's team as the Team card has it: owners, editors and creators, with their photos. Undefined while it loads. */
function useTeam(libraryId: Id<"evidenceLibraries">): TeamPerson[] | undefined {
  const tLabels = useTranslations("libraryHomeSettings");
  const { data } = useProtectedQuery(api.evidenceLibraries.queries.listTeam, { libraryId });
  if (!data) return undefined;
  // Only people the page can name, as it will name them; an email is never shown instead of a name.
  const shown = (people: typeof data.owners, role: string) =>
    people.flatMap((person) => {
      const name = publicName(person.name);
      return name ? [{ id: person.clerkUserId, name, imageUrl: publicPhoto(person.imageUrl), role }] : [];
    });
  return [...shown(data.owners, tLabels("owner")), ...shown(data.editors, tLabels("editor")), ...shown(data.creators, tLabels("creator"))];
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
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
  const update = (id: string, change: Partial<HomePersonDraft>) =>
    onChange(value.map((person) => (person.id === id ? { ...person, ...change } : person)));
  const rows: PickerRow[] = (team ?? []).map((person) => ({ id: person.id, title: person.name, meta: person.role }));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">{t("peopleShown")}</p>
        <div className="flex flex-wrap items-center gap-2">
        <RemotePickerDialog
          mode="multi"
          trigger={
            <Button type="button" variant="outline" size="sm" disabled={value.length >= LIMITS.people}>
              <Plus />
              {t("addFromTheTeam")}
            </Button>
          }
          title={t("addPeopleFromTheTeam")}
          description={t("everyoneOnTheLibrarySTeam")}
          searchLabel={tLabels("searchTheTeam")}
          columns={{ title: t("name"), meta: tLabels("role") }}
          source={localPickerSource(rows)}
          renderLeading={(row) => (
            <IdentityAvatar name={row.title} imageUrl={team?.find((person) => person.id === row.id)?.imageUrl} className="size-7" />
          )}
          usedIds={value.map((person) => person.id)}
          usedLabel={tLabels("shown")}
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
          loadingLabel={tLabels("loadingTheTeam")}
          failedLabel={tLabels("theTeamCouldNotBeRead")}
          emptyLabel={tLabels("nobodyIsOnTheTeamYet")}
          noMatchLabel={tLabels("nobodyOnTheTeamMatches")}
          notSetUpLabel={tLabels("nobodyIsOnTheTeamYet")}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.length >= LIMITS.people}
          onClick={() => onChange([...value, { id: newId(HAND_ENTERED_PREFIX), name: "", photo: "", title: "", location: "" }])}
        >
          <Plus />
          {t("addSomeone")}
        </Button>
        </div>
      </div>
      {value.length === 0 ? (
        <EmptyList>{t("nobodyIsShownAddPeopleFrom")}</EmptyList>
      ) : (
        <SortableList ids={value.map((person) => person.id)} onMove={(from, to) => onChange(move(value, from, to))}>
          {value.map((person) => {
            const byHand = isHandEntered(person.id);
            const member = byHand ? undefined : team?.find((each) => each.id === person.id);
            const name = member?.name || person.name || tLabels("someoneNew");
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
                        {removed ? t("removedFromTheTeamSoNot") : member ? t("onTheTeam", { role: member.role }) : null}
                      </p>
                    </div>
                  </div>
                )}
                {byHand ? (
                  <div className="grid gap-3">
                    <Field label={t("name")} counter={`${person.name.length} / ${LIMITS.personName}`}>
                      {(id) => (
                        <Input
                          id={id}
                          className="bg-background"
                          maxLength={LIMITS.personName}
                          placeholder={t("aminaYusuf")}
                          value={person.name}
                          onChange={(event) => update(person.id, { name: event.target.value })}
                        />
                      )}
                    </Field>

                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("title")} suffix={tLabels("optional")} counter={`${person.title.length} / ${LIMITS.personTitle}`}>
                    {(id) => (
                      <Input
                        id={id}
                        className="bg-background"
                        maxLength={LIMITS.personTitle}
                        placeholder={t("editorInChief")}
                        value={person.title}
                        onChange={(event) => update(person.id, { title: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={t("location")} suffix={tLabels("optional")} counter={`${person.location.length} / ${LIMITS.personLocation}`}>
                    {(id) => (
                      <Input
                        id={id}
                        className="bg-background"
                        maxLength={LIMITS.personLocation}
                        placeholder={t("nairobiKenya")}
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
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
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
  const readOnly = useReadOnly();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: PHOTO_ACCEPT,
    multiple: false,
    disabled: uploading || readOnly,
    onDrop: upload,
    onDropRejected: () => setFailed(true),
  });
  const label = photo ? tLabels("changeThePhotoOf", { name }) : tLabels("addAPhotoOf", { name });
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
                <span aria-hidden className="absolute -bottom-0.5 -end-0.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm">
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
                aria-label={t("removeThePhotoOf", { name })}
                onClick={() => onChange("")}
                className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("removeThePhoto")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{photo ? t("addedByHand") : t("addedByHandClickThePicture")}</p>
        {failed ? <p role="alert" className="text-xs text-destructive">{t("thatPhotoCouldNotBeUsed")}</p> : null}
      </div>
    </div>
  );
}

type ReviewedPublication = { key: string; title: string; publishedAt: string; reviewed: boolean };


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
  const tLabels = useTranslations("libraryHomeSettings");
  const t = useTranslations("libraryHomeSettings");
  const format = useFormatter();
  const publicationRow = useCallback((publication: ReviewedPublication): PickerRow => ({
    id: publication.key,
    title: publication.title,
    meta: t(publication.reviewed ? "reviewedOn" : "addedOn", { date: format.dateTime(new Date(publication.publishedAt), APPROVAL_DATE) }),
  }), [t, format]);
  const listPublications = useAction(api.zotero.runtimeReadActions.listPublications);
  const readPublication = useAction(api.zotero.runtimeReadActions.readPublication);
  const [chosen, setChosen] = useState<PickerRow | null>(null);
  // A saved choice is only a key, so its title is asked for once.
  useEffect(() => {
    if (!value || chosen?.id === value) return;
    let current = true;
    readPublication({ libraryId, key: value })
      .then((found) => {
        if (current && found) setChosen(publicationRow(found));
      })
      // The key stands in for the title when the library cannot answer.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [readPublication, publicationRow, libraryId, value, chosen?.id]);
  const shown = value ? (chosen?.id === value ? chosen : { id: value, title: value }) : null;
  const source: PickerSource = async ({ query, cursor }) => {
    const page = await listPublications({ libraryId, query: query || undefined, paginationOpts: { cursor, numItems: PICKER_PAGE_SIZE } });
    return { reason: page.reason, items: page.page.map(publicationRow), nextCursor: page.isDone ? null : page.continueCursor };
  };
  return (
    <RemotePickerDialog
      mode="single"
      trigger={
        <Button id={id} type="button" variant="outline" className="h-auto w-full justify-start gap-3 bg-background px-3 py-2 text-start font-normal">
          <span className="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground" aria-hidden>
            {shown ? <FileText className="size-4" /> : <RefreshCw className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{shown ? shown.title : t("latestPublication")}</span>
            <span className="block text-xs text-muted-foreground">
              {shown ? (shown.meta ?? t("chosenPublication")) : t("theLatestAnEditorApprovedOr")}
            </span>
          </span>
          <ChevronsUpDown className="shrink-0 text-muted-foreground" />
        </Button>
      }
      title={t("publicationFollowed")}
      description={t("chooseAPublicationWithAPdf")}
      searchLabel={tLabels("searchPublications")}
      columns={{ title: t("publication"), meta: tLabels("date") }}
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
      noneLabel={tLabels("latestPublication")}
      loadingLabel={tLabels("loadingPublications")}
      failedLabel={tLabels("theLibrarySPublicationsCouldNot")}
      emptyLabel={tLabels("noPublicationHasAPdfYet")}
      noMatchLabel={tLabels("noPublicationMatches")}
      notSetUpLabel={tLabels("theLibraryIsNotSetUp")}
    />
  );
}
