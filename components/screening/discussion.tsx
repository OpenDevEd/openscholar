"use client";

// What the reviewers say to each other about one paper: a short thread under its votes, on Screen and in
// the Papers drawer. A line can ask one reviewer, and then waits with them until they answer.

import { useRef, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, Hourglass, MessagesSquare, Send } from "@/components/icons";
import { ListRowsSkeleton } from "@/components/evidence-libraries/list-controls";
import { EASE } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { useTranslations } from "next-intl";
import { activeReviewers, blindOf, personIn, waitingQuestions, type Paper, modelsOf } from "./data";
import { Help, Section, ShutChip, ShutNote, StateChip } from "./pieces";
import type { Open } from "./store";
import { useWords } from "./words";

type ListT = ReturnType<typeof useTranslations<"screening.list">>;

/** A choice of who a line is for. */
const TO = "flex h-6 items-center gap-1.5 rounded-full border text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";
const TO_ON = "border-primary/30 bg-primary/10 text-primary";
const TO_OFF = "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground";


/** What the discussion is and when it is there, behind its "?": the same wherever its title shows, open or shut. The rule that hides it until you vote is named only on a screening that has that rule. */
const about = (t: ListT, open: Open) => (
  <Help title={t("discussion.title")}>
    {/* Said of the people who write here, so it is true for someone who only reads. */}
    <p>{t("discussion.about", { models: String(modelsOf(open.screening).length > 0) })}</p>
    {blindOf(open.screening, open.invited) === "all" || blindOf(open.screening, open.invited) === "people" ? <p>{t("discussion.blind")}</p> : null}
  </Help>
);

/** The discussion where the rule keeps it shut: the others' votes are still hidden from the person looking, and so is what they wrote. */
export function DiscussionShut({ open }: { open: Open }) {
  const t = useTranslations("screening.list");
  return (
    <Section title={t("discussion.title")} help={about(t, open)} aside={<ShutChip by="vote" />}>
      <ShutNote by="vote">{t("discussion.shut")}</ShutNote>
    </Section>
  );
}

/** Lines a paper's discussion reads at a time: nearly every one fits the first. */
const LINES = 50;

/** What is being written on a paper, and to whom: held by the page where it draws the discussion in two places (Screen, by width), so both show the same draft. */
export type DiscussionDraft = { text: string; asking: string | null };

export function Discussion({ open, paper, draft: given, onDraft }: { open: Open; paper: Paper; draft?: DiscussionDraft; /** Changes the draft from what it is at that moment, wherever it was last written. */ onDraft?: (update: (now: DiscussionDraft) => DiscussionDraft) => void }) {
  const { screening } = open;
  const t = useTranslations("screening.list");
  const { ago, firstName, t: shared } = useWords();
  const workspaceId = useWorkspace();
  const lines = usePaginatedQuery(api.screening.discussion.thread, inWorkspace(workspaceId, { jobId: screening.id, paperId: paper.id }), { initialNumItems: LINES });
  const write = useWorkspaceMutation(api.screening.discussion.say);
  // Read the latest first, shown oldest first.
  const said = [...lines.results].reverse();
  const [own, setOwn] = useState<DiscussionDraft>({ text: "", asking: null });
  const draft = given ?? own;
  const setDraft = onDraft ?? setOwn;
  const { text, asking } = draft;
  const setText = (next: string) => setDraft((now) => ({ ...now, text: next }));
  const setAsking = (next: string | null) => setDraft((now) => ({ ...now, asking: next }));
  const field = useRef<HTMLTextAreaElement>(null);
  const me = open.me;
  const last = said.at(-1);
  // Who can be asked: the people still on the screening who vote on this paper or have written about it here, and the person who settles its conflicts. Someone taken off keeps their vote and their words here and can't be asked about them.
  const on = new Set(activeReviewers(screening).filter((one) => one.kind === "person").map((one) => one.id));
  const people = [...new Set([...paper.cast.map((one) => one.reviewer), ...said.map((line) => line.by.id)].filter((id) => on.has(id)).concat(screening.rule.resolver))].filter((id) => id !== me).flatMap((id) => personIn(screening, id) ?? []);
  const to = people.find((one) => one.id === asking) ?? null;
  // A question that waits for the person looking is answered to whoever asked it. One that waits for someone else is named in the corner, whoever has written since.
  const waiting = waitingQuestions(said);
  const mine = waiting.findLast((question) => question.to?.id === me);
  const theirs = waiting.findLast((question) => question.to && question.to.id !== me && on.has(question.to.id));
  const owed = mine?.by;
  const waitingFor = theirs?.to;
  const maySay = open.isReviewer || open.canResolve;
  const send = () => {
    const words = text.trim();
    if (!words) return;
    void write({ jobId: screening.id, paperId: paper.id, text: words, ...(to && !owed ? { to: to.id as Id<"users"> } : {}) }).catch((error) => { setDraft((now) => ({ ...now, text: now.text.trim() ? `${words}\n\n${now.text}` : words })); showStyledToast("error", getErrorMessage(error, t("discussion.notSent"))); });
    // While someone waits for an answer from the person writing, the line is that answer, never a question to whoever was picked before.
    // Who it was for stays chosen: a second line to the same person is the likely next one, and a choice that resets itself is missed.
    setText("");
  };
  return (
    <Section
      title={t("discussion.title")}
      help={about(t, open)}
      aside={owed ? <StateChip tone="primary" icon={MessagesSquare}>{t("discussion.askedYou", { name: firstName(owed.name) })}</StateChip> : waitingFor ? <StateChip tone="info" icon={Hourglass}>{t("discussion.waitingFor", { name: firstName(waitingFor.name) })}</StateChip> : null}
    >
      {/* While the first lines are read, their room is held: "nobody has written" is said only once it is known. */}
      {lines.status === "LoadingFirstPage" ? <ListRowsSkeleton rows={Math.max(1, Math.min(paper.messages ?? 1, 3))} height={44} icon={false} label={t("discussion.loading")} /> : null}
      {/* Older lines than the latest page are there to read, a page at a time. */}
      {lines.status === "CanLoadMore" || lines.status === "LoadingMore" ? <Button variant="ghost" size="sm" className="w-full" disabled={lines.status === "LoadingMore"} onClick={() => lines.loadMore(LINES)}>{lines.status === "LoadingMore" ? <Spinner className="size-4" /> : <ChevronUp />}{t("discussion.earlier")}</Button> : null}
      {said.length ? (
        // Each line carries its own room over and under it, so one that arrives opens from nothing with no gap jumping in beside it. The list takes that room back at its two ends, inside a box of its own so the room between it and the field stays.
        <div>
        <ul className="-my-1.5">
          <AnimatePresence initial={false}>
            {said.map((line) => {
              const person = line.by;
              const asked = line.to ? (line.to.id === me ? shared("youInline") : firstName(line.to.name)) : null;
              return (
                <motion.li
                  key={line.id}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="overflow-hidden"
                  // The pane's scroll is the outside system: a line you just sent pushes the field down, and the field is brought back into view to write the next one.
                  onAnimationComplete={() => { if (line === last && line.by.id === me) field.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }}
                >
                  <div className="flex gap-2.5 py-1.5">
                    <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="mt-0.5 size-6 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-xs">
                        <span className="min-w-0 truncate font-medium">{person.name}</span>
                        {line.by.id === me ? <YouTag /> : null}
                        {asked ? <span className="min-w-0 truncate text-muted-foreground">{t("discussion.asked", { who: asked })}</span> : null}
                        <span className="ms-auto shrink-0 text-muted-foreground">{ago(line.at)}</span>
                      </p>
                      <p className="mt-0.5 text-sm leading-5 [overflow-wrap:anywhere]">{line.text}</p>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        </div>
      ) : null}
      {/* Someone who only looks reads what was written, and is told who writes here. Nothing is left out for them without a word. */}
      {maySay || lines.status === "LoadingFirstPage" ? null : <ShutNote by="reviewer">{t("discussion.readOnly", { empty: String(!said.length), join: String(open.canChange && !open.screening.finishedAt) })}</ShutNote>}
      {maySay ? (
        <div className="space-y-2 rounded-2xl border border-border-subtle p-2.5">
          {/* Who the line is for: everyone on the paper, or one reviewer, which makes it a question that waits with them. The line under the choices says which, and is always there, so choosing moves nothing. */}
          {people.length && !owed ? (
            <div className="space-y-1.5">
              <div role="group" aria-label={t("discussion.whoFor")} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t("discussion.to")}</span>
                <button type="button" aria-pressed={!to} onClick={() => { setAsking(null); field.current?.focus(); }} className={cn(TO, "px-2", !to ? TO_ON : TO_OFF)}>{t("discussion.everyone")}</button>
                {people.map((person) => (
                  <button key={person.id} type="button" aria-pressed={to === person} onClick={() => { setAsking(person.id); field.current?.focus(); }} className={cn(TO, "ps-0.5 pe-2", to === person ? TO_ON : TO_OFF)}>
                    <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-5" />
                    {firstName(person.name)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{to ? t("discussion.forOne", { name: firstName(to.name) }) : t("discussion.forAll")}</p>
            </div>
          ) : null}
          {/* Send keeps its place at the field's first line: the field grows downwards as more is written, and the button doesn't move with it. */}
          <div className="flex items-start gap-2">
            <Textarea
              ref={field}
              rows={2}
              value={text}
              onChange={(event) => setText(event.target.value)}
              // Enter starts a new line, as in any note. With Ctrl or Cmd it sends.
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); } }}
              placeholder={owed ? t("discussion.answerPlaceholder", { name: firstName(owed.name) }) : to ? t("discussion.askPlaceholder", { name: firstName(to.name) }) : t("discussion.allPlaceholder")}
              aria-label={owed ? t("discussion.answerLabel", { name: owed.name }) : to ? t("discussion.askLabel", { name: to.name }) : t("discussion.allLabel")}
              className="max-h-32 min-h-0 min-w-0 flex-1 resize-none py-1.5 text-sm"
            />
            <Button size="sm" disabled={!text.trim()} onClick={send}><Send />{t("discussion.send")}</Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
