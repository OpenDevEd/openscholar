"use client";

// What the reviewers say to each other about one paper: a short thread under its votes, on Screen and in
// the Papers drawer. A line can ask one reviewer, and then waits with them until they answer.

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Hourglass, MessagesSquare, Send } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ago, personOf, type Paper } from "./data";
import { Help, Section, StateChip } from "./parts";
import type { Open } from "./store";

const firstName = (name: string) => name.split(" ")[0]!;

/** Whether a paper has a discussion to show: one was started, or it is or was in conflict, which is what there is to talk over. */
export const discussed = (open: Open, paper: Paper) => open.thread(paper).length > 0 || open.settled[paper.id]!.result === "conflict" || Boolean(open.settled[paper.id]!.resolvedBy);

export function Discussion({ open, paper }: { open: Open; paper: Paper }) {
  const said = open.thread(paper);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const me = open.me;
  const last = said.at(-1);
  // Who can be asked: the people who vote on this paper, and the person who settles its conflicts.
  const people = [...new Set([...open.votes[paper.id]!.filter((one) => one.reviewer.kind === "person" && !one.reviewer.email).map((one) => one.reviewer.id), open.screening.rule.resolver])].filter((id) => id !== me).flatMap((id) => personOf(id) ?? []);
  const to = people.find((one) => one.id === asking) ?? null;
  // A question that waits for the person looking is answered to whoever asked it.
  const owed = last?.to === me ? personOf(last.by) : undefined;
  const waitingFor = last?.to && last.to !== me ? personOf(last.to) : undefined;
  const maySay = open.isReviewer || open.canResolve;
  const send = () => {
    const words = text.trim();
    if (!words) return;
    open.say(paper, words, to?.id);
    setText("");
    setAsking(null);
  };
  if (!maySay && !said.length) return null;
  return (
    <Section
      title="Discussion"
      help={
        <Help title="Discussion">
          Ask a reviewer why they voted as they did, and answer here. A question waits with that reviewer&apos;s screenings until they answer it. Models don&apos;t answer: press one of their answers in the table for the passage they read.
        </Help>
      }
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
      {maySay ? (
        <div className="space-y-2 rounded-2xl border border-border-subtle p-2.5">
          {/* Naming a reviewer makes the line a question for them. Pressed again, it is a line to everyone. */}
          {people.length && !owed ? (
            <div role="group" aria-label="Who to ask" className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Ask</span>
              {people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={to === person}
                  onClick={() => { setAsking(to === person ? null : person.id); field.current?.focus(); }}
                  className={cn("flex h-6 items-center gap-1.5 rounded-full border ps-0.5 pe-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50", to === person ? "border-primary/30 bg-primary/10 text-primary" : "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground")}
                >
                  <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-5" />
                  {firstName(person.name)}
                </button>
              ))}
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
              placeholder={owed ? `Answer ${firstName(owed.name)}` : to ? `Ask ${firstName(to.name)} about their vote` : "Write to this paper's reviewers"}
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
