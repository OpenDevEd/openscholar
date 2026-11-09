"use client";

// MOCK (not wired): the assistant's ask before it adds papers to a community, shown with `?mock=add-papers` on any chat.
// The real card would read the paused step's community and papers (evidenceLibraries/assistant:previewPapers) and send
// the person's choice with their answer.

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleCheck, Hourglass, PublishIcon, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommunityIcon } from "@/components/evidence-libraries/your-communities";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { paperPath } from "@/lib/papers/page-address";
import { KindTile } from "./steps";

type Paper = { id: string; title: string; authors: string[]; year: number; state: "new" | "here" | "waiting" };

const COMMUNITY = {
  name: "OpenDevEd Test",
  faviconUrl: "https://ocivvlhqiwtxvnycqnia.supabase.co/storage/v1/object/public/openscholar/evidence-libraries/r17ccg5kabqprr6dshh6wyjmn58ezwvd/icon-eb009182.png",
  owner: { name: "MVP", imageUrl: null, kind: "organization" as const, workspaceId: "jh7hfjdratmz6chn36qn8905th8fwez5" },
};

const PAPERS: Paper[] = [
  { id: "W4394993020", title: "The effect of peer mentoring program on clinical academic progress and psychological characteristics of operating room students", authors: ["Amin Sedigh", "Sara Bagheri", "Pariya Naeimi", "Vahid Rahmanian", "Mohammad Rezaei"], year: 2024, state: "new" },
  { id: "W2126314681", title: "Challenges and opportunities for teacher professional development in interactive use of technology in African schools", authors: ["Sara Hennessy", "Bjoern Haßler", "Riikka Hofmann"], year: 2015, state: "new" },
  { id: "W2565346880", title: "Relationships between teachers` pedagogical beliefs, subject cultures, and mediation practices of students' use of digital technology", authors: ["Agnese Dāvidsone", "Andra Siibak", "Pille Pruulmann-Vengerfeldt"], year: 2015, state: "here" },
];

const authorsLine = (authors: string[]) => (authors.length > 2 ? `${authors.slice(0, 2).join(", ")} +${authors.length - 2}` : authors.join(", "));

export function AddPapersApprovalMock({ canPublish = true }: { canPublish?: boolean }) {
  const [publish, setPublish] = useState(canPublish);
  const [answer, setAnswer] = useState<"published" | "queued" | "declined" | null>(null);
  const adding = PAPERS.filter((paper) => paper.state === "new").length;
  if (answer) return <Answered answer={answer} count={adding} />;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.04]">
      <div className="flex items-start gap-3 p-4 pb-3">
        <KindTile kind="library" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Add {adding} papers to a community</p>
          {/* The community as Add to community lists it: its icon with its owner in the corner, its name, its owner. */}
          <div className="mt-2 flex min-w-0 items-center gap-2.5">
            <CommunityIcon community={COMMUNITY} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{COMMUNITY.name}</p>
              <p className="truncate text-xs text-muted-foreground">{COMMUNITY.owner.name}</p>
            </div>
          </div>
        </div>
        <TooltipHint label="Decline">
          <button type="button" aria-label="Decline" onClick={() => setAnswer("declined")} className="-me-1 -mt-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </TooltipHint>
      </div>
      {/* The papers, as their pages name them; one the community already holds or is reviewing says so and isn't sent again. */}
      <ul className="mx-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-background">
        {PAPERS.map((paper) => (
          <li key={paper.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <a href={paperPath(paper.id, paper.title)} target="_blank" rel="noopener noreferrer" className={paper.state === "new" ? "line-clamp-1 text-sm font-medium hover:underline" : "line-clamp-1 text-sm font-medium text-muted-foreground hover:underline"}>
                {paper.title}
              </a>
              <p className="mt-0.5 flex min-w-0 gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{authorsLine(paper.authors)}</span>
                <span className="shrink-0 tabular-nums">{paper.year}</span>
              </p>
            </div>
            {paper.state === "here" ? (
              <StatusChip className="shrink-0" tone="neutral" icon={Check}>Already in it</StatusChip>
            ) : paper.state === "waiting" ? (
              <StatusChip className="shrink-0" tone="warning" icon={Hourglass}>In review</StatusChip>
            ) : null}
          </li>
        ))}
      </ul>
      {/* Where they go. Owners and editors choose; anyone else's wait for review, which the card says instead. */}
      <div className="px-4 pt-3 pb-4">
        {canPublish ? (
          <Tabs value={publish ? "publish" : "queue"} onValueChange={(value) => setPublish(value === "publish")}>
            <TabsList className="w-full">
              <TabsTrigger value="publish"><PublishIcon />Publish now</TabsTrigger>
              <TabsTrigger value="queue"><Hourglass />Review queue</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {publish ? `They go live on ${COMMUNITY.name} as soon as you allow it.` : `They wait in ${COMMUNITY.name}'s review queue until its team approves them.`}
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-primary/15 p-3">
        <Button className="h-9" onClick={() => setAnswer(publish ? "published" : "queued")}>
          {publish ? <PublishIcon /> : <Hourglass />}
          {publish ? `Publish ${adding} papers` : `Send ${adding} papers for review`}
        </Button>
        <Button className="h-9 px-4" variant="secondary" onClick={() => setAnswer("declined")}>
          Not now
        </Button>
      </div>
    </motion.div>
  );
}

/** After the answer, as the run map would show the step. */
function Answered({ answer, count }: { answer: "published" | "queued" | "declined"; count: number }) {
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 rounded-2xl border border-border/70 px-4 py-3 text-sm">
        {answer === "published" ? <CircleCheck className="size-4 text-primary" /> : answer === "queued" ? <Hourglass className="size-4 text-muted-foreground" /> : <X className="size-4 text-muted-foreground" />}
        {answer === "published" ? `Published ${count} papers on ${COMMUNITY.name}` : answer === "queued" ? `Sent ${count} papers to ${COMMUNITY.name}'s review queue` : "Not added"}
      </motion.div>
    </AnimatePresence>
  );
}
