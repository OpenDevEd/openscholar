"use client";

// What the reviewers say to each other about one paper: a short thread under its votes, on Screen and in
// the Papers drawer. A line can ask one reviewer, and then waits with them until they answer.

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Hourglass, MessagesSquare, Send } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { HelpFact } from "@/components/ui/help";
import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ago, firstName, personOf, waitingQuestions, type Paper } from "./data";
import { Help, SHUT, Section, ShutChip, ShutNote, StateChip, type Shut } from "./parts";
import type { Open } from "./store";

/** A choice of who a line is for. */
const TO = "flex h-6 items-center gap-1.5 rounded-full border text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";
const TO_ON = "border-primary/30 bg-primary/10 text-primary";
const TO_OFF = "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground";

/** Whether a paper has a discussion to show: one was started, or it is or was in conflict, which is what there is to talk over. */
export const discussed = (open: Open, paper: Paper) => open.thread(paper).length > 0 || open.settled[paper.id]!.result === "conflict" || Boolean(open.settled[paper.id]!.resolvedBy);

/** What the discussion is and when it is there, behind its "?": the same wherever its title shows, open or shut. The rule that hides it until you vote is named only on a screening that has that rule. */
const about = (open: Open) => (
  <Help title="Discussion" facts={<>{(open.screening.rule.blind === "after" ? (["conflict", "vote"] as const) : (["conflict"] as const)).map((by) => { const Icon = SHUT[by].icon; return <HelpFact key={by} icon={Icon}>{SHUT[by].says}</HelpFact>; })}</>}>
    Write to everyone on this paper, or to one reviewer. A line to one reviewer is a question: it shows on their Screening list and on Screen, as a question for them, until they answer it. Models don&apos;t answer: press one of their answers in the table for the passage they read.
  </Help>
);

/**
 * The discussion where a rule keeps it shut.
 * `vote`: the others' votes are still hidden from the person looking, and so is what they wrote. `conflict`: the votes show, and the paper has had no conflict to talk over.
 */
export function DiscussionShut({ open, by }: { open: Open; by: Shut }) {
  return (
    <Section title="Discussion" help={about(open)} aside={<ShutChip by={by} />}>
      {/* "In conflict" is the result's own name: votes that differ while one is still awaited are not a conflict yet, and the result over the votes says which it is. */}
      <ShutNote by={by}>Reviewers talk over a paper in conflict here.{by === "vote" ? " It stays out of sight so it can't sway your vote." : null}</ShutNote>
    </Section>
  );
}

export function Discussion({ open, paper }: { open: Open; paper: Paper }) {
  const said = open.thread(paper);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const me = open.me;
  const last = said.at(-1);
  // Who can be asked: the people still on the screening who vote on this paper, and the person who settles its conflicts. Someone taken off keeps their vote here and can't be asked about it.
  const people = [...new Set([...open.votes[paper.id]!.filter((one) => one.reviewer.kind === "person" && !one.reviewer.email && !one.reviewer.left).map((one) => one.reviewer.id), open.screening.rule.resolver])].filter((id) => id !== me).flatMap((id) => personOf(id) ?? []);
  const to = people.find((one) => one.id === asking) ?? null;
  // A question that waits for the person looking is answered to whoever asked it. One that waits for someone else is named in the corner, whoever has written since.
  const waiting = waitingQuestions(said);
  const mine = waiting.findLast((question) => question.to === me);
  const theirs = waiting.findLast((question) => question.to !== me && open.screening.reviewers.some((one) => one.id === question.to && !one.left));
  const owed = mine ? personOf(mine.by) : undefined;
  const waitingFor = theirs ? personOf(theirs.to!) : undefined;
  const maySay = open.isReviewer || open.canResolve;
  const send = () => {
    const words = text.trim();
    if (!words) return;
    open.say(paper, words, to?.id);
    // Who it was for stays chosen: a second line to the same person is the likely next one, and a choice that resets itself is missed.
    setText("");
  };
  return (
    <Section
      title="Discussion"
      help={about(open)}
      aside={owed ? <StateChip tone="primary" icon={MessagesSquare}>{firstName(owed.name)} asked you</StateChip> : waitingFor ? <StateChip tone="info" icon={Hourglass}>Waiting for {firstName(waitingFor.name)}</StateChip> : null}
    >
      {said.length ? (
        // Each line carries its own room over and under it, so one that arrives opens from nothing with no gap jumping in beside it. The list takes that room back at its two ends, inside a box of its own so the room between it and the field stays.
        <div>
        <ul className="-my-1.5">
          <AnimatePresence initial={false}>
            {said.map((line) => {
              const person = personOf(line.by);
              const asked = line.to ? (line.to === me ? "you" : firstName(personOf(line.to)?.name ?? "a reviewer")) : null;
              return (
                <motion.li
                  key={`${line.by}:${line.at}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="overflow-hidden"
                  // The pane's scroll is the outside system: a line you just sent pushes the field down, and the field is brought back into view to write the next one.
                  onAnimationComplete={() => { if (line === last && line.by === me) field.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }}
                >
                  <div className="flex gap-2.5 py-1.5">
                    <IdentityAvatar name={person?.name ?? ""} imageUrl={person?.imageUrl} className="mt-0.5 size-6 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-xs">
                        <span className="truncate font-medium">{person?.name ?? "A reviewer"}</span>
                        {line.by === me ? <YouTag /> : null}
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
      {maySay ? null : <ShutNote by="reviewer">{said.length ? "Only this screening's reviewers write here." : "Nobody has written about this paper yet. Only this screening's reviewers write here."}</ShutNote>}
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
              <p className="text-xs text-muted-foreground">{to ? `For ${firstName(to.name)} to answer. Everyone on this paper sees it, and it stays on ${firstName(to.name)}'s Screening list until then.` : "Everyone who votes on this paper sees it. Pick a name to put a question to one of them."}</p>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <Textarea
              ref={field}
              rows={2}
              value={text}
              onChange={(event) => setText(event.target.value)}
              // Enter starts a new line, as in any note. With Ctrl or Cmd it sends.
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); } }}
              placeholder={owed ? `Answer ${firstName(owed.name)}` : to ? `Ask ${firstName(to.name)} about their vote` : "Write to everyone on this paper"}
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
