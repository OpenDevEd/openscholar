"use client";

// What the reviewers say to each other about one paper: a short thread under its votes, on Screen and in
// the Papers drawer. A line can ask one reviewer, and then waits with them until they answer.

import { useRef, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { Hourglass, MessagesSquare, Send } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";

import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { activeReviewers, ago, firstName, personIn, waitingQuestions, type Paper, modelsOf } from "./data";
import { Help, Section, ShutChip, ShutNote, StateChip } from "./pieces";
import type { Open } from "./store";

/** A choice of who a line is for. */
const TO = "flex h-6 items-center gap-1.5 rounded-full border text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";
const TO_ON = "border-primary/30 bg-primary/10 text-primary";
const TO_OFF = "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground";


/** What the discussion is and when it is there, behind its "?": the same wherever its title shows, open or shut. The rule that hides it until you vote is named only on a screening that has that rule. */
const about = (open: Open) => (
  <Help title="Discussion">
    {/* Said of the people who write here, so it is true for someone who only reads. */}
    <p>Reviewers and the person who settles conflicts talk a paper over here, with everyone on it or with one person. A line to one person is a question: it stays on their Screening list until they answer.{modelsOf(open.screening).length ? " A model can't be asked: press one of its marks in the table for the passage it read." : ""}</p>
    {open.screening.rule.blind === "after" ? <p>This screening hides what is written about a paper from a reviewer only while the paper still waits for that reviewer&apos;s own vote.</p> : null}
  </Help>
);

/** The discussion where the rule keeps it shut: the others' votes are still hidden from the person looking, and so is what they wrote. */
export function DiscussionShut({ open }: { open: Open }) {
  return (
    <Section title="Discussion" help={about(open)} aside={<ShutChip by="vote" />}>
      <ShutNote by="vote">Reviewers talk a paper over here. It stays out of sight so it can&apos;t sway your vote.</ShutNote>
    </Section>
  );
}

/** Lines a paper's discussion reads at a time: nearly every one fits the first. */
const LINES = 50;

export function Discussion({ open, paper }: { open: Open; paper: Paper }) {
  const { screening } = open;
  const workspaceId = useWorkspace();
  const lines = usePaginatedQuery(api.screening.discussion.thread, inWorkspace(workspaceId, { jobId: screening.id, paperId: paper.id }), { initialNumItems: LINES });
  const write = useWorkspaceMutation(api.screening.discussion.say);
  // Read the latest first, shown oldest first.
  const said = [...lines.results].reverse();
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
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
    void write({ jobId: screening.id, paperId: paper.id, text: words, ...(to ? { to: to.id as Id<"users"> } : {}) }).catch((error) => { setText(words); showStyledToast("error", getErrorMessage(error, "That wasn't sent. Try again.")); });
    // Who it was for stays chosen: a second line to the same person is the likely next one, and a choice that resets itself is missed.
    setText("");
  };
  return (
    <Section
      title="Discussion"
      help={about(open)}
      aside={owed ? <StateChip tone="primary" icon={MessagesSquare}>{firstName(owed.name)} asked you</StateChip> : waitingFor ? <StateChip tone="info" icon={Hourglass}>Waiting for {firstName(waitingFor.name)}&apos;s answer</StateChip> : null}
    >
      {said.length ? (
        // Each line carries its own room over and under it, so one that arrives opens from nothing with no gap jumping in beside it. The list takes that room back at its two ends, inside a box of its own so the room between it and the field stays.
        <div>
        <ul className="-my-1.5">
          <AnimatePresence initial={false}>
            {said.map((line) => {
              const person = line.by;
              const asked = line.to ? (line.to.id === me ? "you" : firstName(line.to.name)) : null;
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
                        <span className="truncate font-medium">{person.name}</span>
                        {line.by.id === me ? <YouTag /> : null}
                        {asked ? <span className="shrink-0 text-muted-foreground">asked {asked}</span> : null}
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
      {maySay ? null : <ShutNote by="reviewer">{said.length ? "" : "Nobody has written about this paper yet. "}Only its reviewers and the person who settles conflicts write here.{open.canChange && !open.screening.finishedAt ? " Join as a reviewer to write." : ""}</ShutNote>}
      {maySay ? (
        <div className="space-y-2 rounded-2xl border border-border-subtle p-2.5">
          {/* Who the line is for: everyone on the paper, or one reviewer, which makes it a question that waits with them. The line under the choices says which, and is always there, so choosing moves nothing. */}
          {people.length && !owed ? (
            <div className="space-y-1.5">
              <div role="group" aria-label="Who it is for" className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">To</span>
                <button type="button" aria-pressed={!to} onClick={() => { setAsking(null); field.current?.focus(); }} className={cn(TO, "px-2", !to ? TO_ON : TO_OFF)}>Everyone</button>
                {people.map((person) => (
                  <button key={person.id} type="button" aria-pressed={to === person} onClick={() => { setAsking(person.id); field.current?.focus(); }} className={cn(TO, "ps-0.5 pe-2", to === person ? TO_ON : TO_OFF)}>
                    <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-5" />
                    {firstName(person.name)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{to ? `For ${firstName(to.name)} to answer. Everyone who can see this paper's votes reads it, and it stays on ${firstName(to.name)}'s Screening list until then.` : "Everyone who can see this paper's votes reads it. Pick a name to ask one person a question."}</p>
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
              placeholder={owed ? `Answer ${firstName(owed.name)}` : to ? `Ask ${firstName(to.name)} a question` : "Write to everyone on this paper"}
              aria-label={owed ? `Your answer to ${owed.name}` : to ? `Your question for ${to.name}` : "Your message"}
              className="max-h-32 min-h-0 min-w-0 flex-1 resize-none py-1.5 text-sm"
            />
            <Button size="sm" disabled={!text.trim()} onClick={send}><Send />Send</Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
