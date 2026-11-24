"use client";

// Pieces the screening mock's pages share: the surfaces and chips that tell kinds of things apart, a
// section with its "?", a reviewer's face or model mark, a vote, a paper's result, and the worked
// examples that show what a rule does.

import { useEffect, useRef, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from "react";
import NextLink from "next/link";
import { ArrowRight, Check, ChevronRight, CircleDashed, GitCompare, Hourglass, Lock, Mail, Minus, TriangleAlert, X, type AppIcon } from "@/components/icons";
import { getModelIcon } from "@/components/icons/provider-icons";
import { Chip, RequiredMark } from "@/components/screening/parts";
import { tintOf } from "@/components/settings/model-map";
import { HELP_POPOVER, HelpButton } from "@/components/ui/help";
import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { useIsMobile } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { Answer } from "@/lib/screening/setup";
import { DECISION_LABEL, RESULTS, RESULT_LABEL, reasonLabel, type Criterion, type Decision, type Result, type Reviewer, type Rule, type Vote } from "./data";

/**
 * The "?" beside a label: what the label means, and how the thing works, said once where a person asks
 * for it. The page itself explains nothing in a sentence. `facts` are HelpFact chips under the text.
 * It opens beside its "?" on a wide screen and under it on a phone.
 */
export function Help({ title, children, facts, side, className }: { title: string; children: ReactNode; facts?: ReactNode; /** Where it opens, for a "?" whose usual side would cover what it explains. */ side?: "top" | "bottom" | "left"; className?: string }) {
  const beside = !useIsMobile();
  return (
    <Popover>
      <PopoverTrigger asChild><HelpButton aria-label={`About ${title}`} className={className} /></PopoverTrigger>
      <PopoverContent side={side ?? (beside ? "right" : "bottom")} align="start" aria-label={`About ${title}`} className={HELP_POPOVER}>
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{title}</p>
            <div className="space-y-2 text-sm/5 text-pretty text-muted-foreground">{children}</div>
          </div>
          {facts ? <div className="flex flex-wrap gap-1.5">{facts}</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Where a page's content starts under the bars that stick to the top of the window: for an anchor another page links to. */
export const BELOW_HEADER = "scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+1rem)]";

/**
 * The colours that tell kinds of things apart, the same on every page. Neutral is a plain fact. Primary
 * is something that waits for the person looking. Success is included, warning is maybe or a shortfall,
 * info is a conflict, destructive is excluded or a failure. A colour is never used for anything else:
 * "new" and "living" are not green, because green is Included.
 */
export type Tone = "neutral" | "primary" | "success" | "warning" | "info" | "destructive";
export const TONE: Record<Tone, { chip: string; hover: string; panel: string; ink: string }> = {
  neutral: { chip: "bg-foreground/[0.06] text-muted-foreground", hover: "hover:bg-foreground/10", panel: "bg-inset", ink: "text-muted-foreground" },
  primary: { chip: "bg-primary/12 text-primary", hover: "hover:bg-primary/20", panel: "bg-primary/8", ink: "text-primary" },
  success: { chip: "bg-success/12 ink-success", hover: "hover:bg-success/20", panel: "bg-success/10", ink: "ink-success" },
  warning: { chip: "bg-warning/12 ink-warning", hover: "hover:bg-warning/20", panel: "bg-warning/10", ink: "ink-warning" },
  info: { chip: "bg-info/12 text-info", hover: "hover:bg-info/20", panel: "bg-info/10", ink: "text-info" },
  destructive: { chip: "bg-destructive/10 ink-destructive", hover: "hover:bg-destructive/15", panel: "bg-destructive/8", ink: "ink-destructive" },
};

/** Where a paper stands, and a vote: one colour and one sign each, on every bar, chip, mark, count and button. Maybe is a dashed circle, never a "?", which is help. */
export const RESULT_STYLE: Record<Result, { bar: string; chip: string; icon: AppIcon; tone: Tone }> = {
  include: { bar: "bg-success", chip: TONE.success.chip, icon: Check, tone: "success" },
  maybe: { bar: "bg-warning", chip: TONE.warning.chip, icon: CircleDashed, tone: "warning" },
  exclude: { bar: "bg-destructive/45", chip: TONE.destructive.chip, icon: X, tone: "destructive" },
  conflict: { bar: "bg-info", chip: TONE.info.chip, icon: GitCompare, tone: "info" },
  waiting: { bar: "bg-foreground/10", chip: TONE.neutral.chip, icon: Hourglass, tone: "neutral" },
};

/** An icon in one colour, for a control that takes an icon and would draw it in its text's colour: a tab, a menu item. Made once, outside any component, so the control keeps the same icon from one draw to the next. */
export const tinted = (Icon: AppIcon, tone: Tone): ComponentType<{ className?: string }> => function Tinted({ className }) { return <Icon className={cn(TONE[tone].ink, className)} />; };
/** Each result's icon in its own colour. */
export const RESULT_ICON = Object.fromEntries(RESULTS.map((result) => [result, tinted(RESULT_STYLE[result].icon, RESULT_STYLE[result].tone)])) as Record<Result, ComponentType<{ className?: string }>>;
/** A count in a tab, in the colour of what it counts while there is any: what waits for you is primary, a conflict is blue. */
export function TabCount({ value, tone = "neutral" }: { value: number; tone?: Tone }) {
  return <span className={cn("tabular-nums", value ? TONE[tone].ink : "text-muted-foreground")}>{value.toLocaleString("en-GB")}</span>;
}

/**
 * A region's surface says what kind of region it is. A well (neutral) holds facts about the screening.
 * A tinted panel is the one thing that needs someone now, in the colour of what it is about. Lists and
 * tables are cards (LIST in settings/parts). Nothing sits in a box for decoration.
 */
export function Panel({ tone = "neutral", className, ...rest }: ComponentProps<"div"> & { tone?: Tone }) {
  return <div {...rest} className={cn("rounded-2xl p-4", TONE[tone].panel, className)} />;
}

/** A chip tinted by what it says about a paper or a screening. A plain fact stays on the neutral Chip. */
export function StateChip({ tone, className, ...chip }: ComponentProps<typeof Chip> & { tone: Tone }) {
  return <Chip {...chip} className={cn(TONE[tone].chip, "font-medium", className)} />;
}

/** A chip that opens something: the tint of what it says, an arrow at its end, and a fuller tint under the pointer. Every chip that can be pressed is one of these, so a chip without the arrow is never a button. */
export function LinkChip({ href, tone = "neutral", icon, children, className, ...link }: Omit<ComponentProps<typeof NextLink>, "children"> & { tone?: Tone; icon?: AppIcon; children: ReactNode }) {
  return (
    <NextLink {...link} href={href} className={cn("flex min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>
      <Chip icon={icon} className={cn(TONE[tone].chip, TONE[tone].hover, "min-w-0 shrink pe-1 font-medium transition-colors")}>
        <span className="truncate">{children}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 opacity-60" />
      </Chip>
    </NextLink>
  );
}

/** A titled part of a page, with an anchor other pages link to. Its "?" (a Help) holds what would otherwise be a sentence under the title. */
export function Section({ id, title, help, aside, className, children }: { id?: string; title: ReactNode; help?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn("space-y-3", BELOW_HEADER, className)}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex shrink-0 items-center gap-1 text-sm font-semibold">{title}{help}</h2>
        {/* The aside takes the room left and no more: on a narrow screen it wraps under the title. */}
        {aside ? <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A column beside the page's main content that stays in view without a height or a scrollbar of its
 * own. It sticks under the header while it fits in the window. Where it is taller than the window,
 * `tall` says what it does: "foot" (the default) scrolls it with the page until its foot is in view and
 * sticks there, for a column read from top to bottom such as an open paper; "flow" leaves it in the
 * page's flow, for a column whose first lines matter most, such as a form's summary. `clear` is the
 * room kept under it, for a page with an ActionBar at the window's foot. Its own height is the outside
 * system it measures: a ResizeObserver writes it to a CSS variable, and the rest is CSS.
 */
export function StickyColumn({ clear = "1rem", tall = "foot", className, children }: { clear?: string; tall?: "foot" | "flow"; className?: string; children: ReactNode }) {
  const column = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = column.current;
    if (!element) return;
    const observer = new ResizeObserver(() => element.style.setProperty("--column-height", `${element.offsetHeight}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const under = "(var(--app-navbar-height) + var(--page-header-height, 4rem))";
  // The room left over once the column is in the window: none, and it doesn't fit.
  const room = `(100dvh - ${under} - var(--column-height, 0px) - ${clear})`;
  // "flow": 1px of room or more keeps it under the header; with none, its place to stick is far above the window, so it never sticks.
  const top = tall === "foot" ? `min(${under}, 100dvh - var(--column-height, 0px) - ${clear})` : `calc(${under} - (1px - clamp(0px, ${room} * 9999, 1px)) * 99999)`;
  return (
    <div ref={column} style={{ top }} className={cn("sticky self-start", className)}>
      {children}
    </div>
  );
}

/**
 * The page's main action, at the foot of the window however long the page is: the vote on Screen,
 * Start on a new screening, Save in the settings. It is the last thing in the page's card. Below lg,
 * where the page reaches the window's edge, what is in it keeps clear of the assistant's button in the
 * corner (max-lg:pe-[5.5rem]). From lg up the wide page itself stops short of that button.
 */
export function ActionBar({ className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={cn("sticky bottom-0 z-20 border-t border-border-subtle bg-card shadow-[0_-10px_30px_-22px_rgb(0_0_0/0.3)]", className)} />;
}

/** A reviewer's name with what kind of reviewer it is: You after your own, AI after a model's. One marker, the same on every page. */
export function ReviewerName({ reviewer, you = false, className }: { reviewer: Pick<Reviewer, "kind" | "name">; you?: boolean; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate">{reviewer.name}</span>
      {you ? <YouTag /> : reviewer.kind === "model" ? <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 text-2xs font-normal leading-5 text-muted-foreground">AI</span> : null}
    </span>
  );
}

/** A person's photo, an envelope for someone invited who has no account yet, or a model's mark in its maker's colour. */
export function ReviewerMark({ reviewer, you = false, className }: { reviewer: Pick<Reviewer, "kind" | "name" | "imageUrl" | "email" | "model">; /** Rings your own face, where faces stand without names. */ you?: boolean; className?: string }) {
  if (you) return <span className="flex shrink-0 rounded-full ring-2 ring-primary/70 ring-offset-1 ring-offset-card"><ReviewerMark reviewer={reviewer} className={className} /></span>;
  if (reviewer.email) {
    return (
      <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", className)}>
        <Mail className="size-[55%]" />
      </span>
    );
  }
  if (reviewer.kind === "person") return <IdentityAvatar name={reviewer.name} imageUrl={reviewer.imageUrl} className={cn("size-6", className)} />;
  const Brand = getModelIcon(reviewer.model!.id);
  const tint = tintOf(reviewer.model!.id);
  return (
    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-card", className)} style={{ color: tint }}>
      <Brand className="size-[62%]" />
    </span>
  );
}

/** Reviewers as overlapping marks, people first. */
export function ReviewerStack({ reviewers, max = 7, className }: { reviewers: Reviewer[]; max?: number; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center", className)}>
      {reviewers.slice(0, max).map((reviewer, i) => (
        <TooltipHint key={reviewer.id} label={reviewer.name}>
          <span className={cn("flex ring-2 ring-card", reviewer.kind === "model" ? "rounded-md" : "rounded-full", i > 0 && "-ms-1.5")} tabIndex={0}>
            <ReviewerMark reviewer={reviewer} />
          </span>
        </TooltipHint>
      ))}
      {reviewers.length > max ? <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">+{reviewers.length - max}</span> : null}
    </span>
  );
}

/** One vote as a small square with its sign. `hidden` is a vote cast but not shown yet, to someone who hasn't voted. */
export function VoteMark({ vote, hidden = false, failed = false, who, className }: { vote?: Pick<Vote, "decision">; hidden?: boolean; failed?: boolean; who: string; className?: string }) {
  if (failed) {
    return (
      <TooltipHint label={`${who} couldn't read it`}>
        <span role="img" tabIndex={0} aria-label={`${who}: couldn't read it`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-destructive text-white", className)}>
          <TriangleAlert aria-hidden className="size-3.5" />
        </span>
      </TooltipHint>
    );
  }
  if (!vote) {
    return (
      <span role="img" aria-label={`${who}: no vote yet`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground", className)}>
        <Hourglass aria-hidden className="size-3" />
      </span>
    );
  }
  if (hidden) {
    return (
      <span role="img" aria-label={`${who}: voted, hidden until you vote`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}>
        <Lock aria-hidden className="size-3" />
      </span>
    );
  }
  const { icon: Icon, chip } = RESULT_STYLE[vote.decision];
  return (
    <span role="img" aria-label={`${who}: ${DECISION_LABEL[vote.decision]}`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", chip, className)}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** Where a paper stands, as a chip. */
export function ResultChip({ result, className }: { result: Result; className?: string }) {
  const { icon: Icon, chip } = RESULT_STYLE[result];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium", chip, className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {RESULT_LABEL[result]}
    </span>
  );
}

/**
 * A criterion goes by its short name in tables, chips and reasons. Pointing at one shows the question
 * it stands for, or the whole of a label that is cut off where the name is the question's own words.
 */
export function QuestionHint({ question, label, children }: { question?: string; label: string; children: ReactElement }) {
  return <TooltipHint label={question ?? label} onlyWhenClipped={!question}>{children}</TooltipHint>;
}
/** A short name or a reason that isn't a link or a button, with its question: it takes the keyboard while it has one to show. */
export function QuestionName({ question, label, className, children }: { question?: string; label: string; className?: string; /** What stands for the label, where that is more than its words. */ children?: ReactNode }) {
  return (
    <QuestionHint question={question} label={label}>
      <span tabIndex={question ? 0 : undefined} className={cn(question && "rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>{children ?? label}</span>
    </QuestionHint>
  );
}

/** A fact with its name: the name quiet, the fact in the text's own weight. What "Name: fact" would say, drawn with weight in place of a colon. */
export function Named({ name, children }: { name: string; children: ReactNode }) {
  return <><span className="shrink-0 font-normal text-muted-foreground">{name}</span><span className="min-w-0 truncate">{children}</span></>;
}

/**
 * Why a paper was excluded, or what a Maybe is unclear on, drawn in place of "Not met: name": the criterion's short name
 * behind the sign its answer has, a red cross for one not met and an amber dash for one left unclear. A reason that is
 * not a criterion is its own words.
 */
export function Reason({ reason, criteria, unclear = false, className }: { reason: string; criteria: Criterion[]; unclear?: boolean; className?: string }) {
  const criterion = criteria.find((one) => one.key === reason);
  if (!criterion) return <span className={cn("truncate", className)}>{reasonLabel(reason, criteria)}</span>;
  const { icon: Icon, tone } = ANSWER_SIGN[unclear ? "unclear" : "no"];
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1", className)}>
      <Icon role="img" aria-label={unclear ? "Unclear on" : "Not met,"} className={cn("size-3.5 shrink-0", TONE[tone].ink)} />
      <span className="truncate">{criterion.short}</span>
    </span>
  );
}

/** A screening's papers as one bar, split by where they stand. */
export function ResultBar({ counts, className }: { counts: Record<Result, number>; className?: string }) {
  const total = RESULTS.reduce((sum, result) => sum + counts[result], 0);
  const label = RESULTS.filter((result) => counts[result]).map((result) => `${counts[result].toLocaleString("en-GB")} ${RESULT_LABEL[result].toLowerCase()}`).join(", ") || "No papers yet";
  return (
    <TooltipHint label={label}>
      <div role="img" aria-label={label} tabIndex={0} className={cn("flex h-2.5 w-full gap-px overflow-hidden rounded-full", className)}>
        {total === 0 ? <span className="h-full flex-1 rounded-full bg-foreground/10" /> : null}
        {RESULTS.map((result) =>
          counts[result] ? (
            <span
              key={result}
              className={cn("h-full min-w-1.5 basis-0 transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none", RESULT_STYLE[result].bar)}
              // Waiting is hatched, so papers still to be voted on never read as excluded ones.
              style={{ flexGrow: counts[result], ...(result === "waiting" ? { backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 3px, color-mix(in oklab, var(--foreground) 14%, transparent) 3px 5px)" } : {}) }}
            />
          ) : null,
        )}
      </div>
    </TooltipHint>
  );
}

/** How a paper's reviewers voted, as a count beside each decision's mark. */
export function Tally({ votes, className }: { votes: Array<Pick<Vote, "decision">>; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {(["include", "maybe", "exclude"] as const).map((decision) => {
        const n = votes.filter((vote) => vote.decision === decision).length;
        const Icon = RESULT_STYLE[decision].icon;
        return n ? (
          <span key={decision} role="img" aria-label={`${n} ${DECISION_LABEL[decision].toLowerCase()}`} className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
            {n}
          </span>
        ) : null;
      })}
    </span>
  );
}

/** A key the button beside it answers to. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-subtle bg-card px-1 font-sans text-2xs font-medium text-muted-foreground", className)}>{children}</kbd>;
}

/** A criterion's words, with the must-have mark kept on the line of its last word. */
export function CriterionText({ text, must }: { text: string; must: boolean }) {
  if (!must) return <>{text}</>;
  const at = text.lastIndexOf(" ");
  return <>{text.slice(0, at + 1)}<span className="whitespace-nowrap">{text.slice(at + 1)}<RequiredMark /></span></>;
}

/**
 * What a rule does, shown on three made-up papers: the votes a paper might get, an arrow, and where
 * that leaves it. It stands in for a paragraph of explanation.
 */
export function RuleExamples({ rule, people, models }: { rule: Rule; people: number; models: number }) {
  const votes = Math.max(1, models + (rule.each === "all" ? people : Math.min(Number(rule.each), people)));
  const row = (decisions: Array<Decision | null>): Result => {
    const cast = decisions.flatMap((d) => d ?? []);
    if (rule.settle === "one") return cast[0] ?? "waiting";
    if (cast.length < decisions.length) return "waiting";
    const top = (["include", "maybe", "exclude"] as const).map((d) => ({ d, n: cast.filter((c) => c === d).length })).sort((a, b) => b.n - a.n)[0]!;
    if (rule.settle === "all") return top.n === cast.length ? top.d : "conflict";
    return top.n * 2 > cast.length ? top.d : "conflict";
  };
  const fill = (first: Decision, rest: Decision) => Array.from({ length: votes }, (_, i) => (i === 0 ? first : rest));
  const examples: Array<Array<Decision | null>> = [
    fill("include", "include"),
    votes > 1 ? fill("exclude", "include") : fill("exclude", "exclude"),
    [...fill("include", "include").slice(0, -1), null],
  ];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {examples.map((decisions, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex gap-0.5">
            {decisions.slice(0, 6).map((decision, n) => <VoteMark key={n} vote={decision ? { decision } : undefined} who={`Reviewer ${n + 1}`} className="size-5" />)}
          </span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <ResultChip result={row(decisions)} />
        </div>
      ))}
    </div>
  );
}

/** An answer to a criterion, with its sign and its name. Unclear is a dash, never a "?", which is help. */
export const ANSWER_SIGN: Record<Answer, { icon: AppIcon; label: string; tone: Tone }> = { yes: { icon: Check, label: "Yes", tone: "success" }, no: { icon: X, label: "No", tone: "destructive" }, unclear: { icon: Minus, label: "Unclear", tone: "warning" } };

/** One answer as a small square with its sign. `label` names whose answer it is, or to which criterion. */
export function AnswerMark({ answer, label, pressable = false }: { answer: Answer; label: string; /** Drawn as a button, outlined on the card's white: for an answer that opens something. One that opens nothing is a flat tint. */ pressable?: boolean }) {
  const { icon: Icon, label: said, tone } = ANSWER_SIGN[answer];
  return (
    <span role="img" aria-label={`${label}: ${said}`} className={cn("inline-flex size-6 items-center justify-center rounded-md", pressable ? cn("border border-current/45 bg-card shadow-xs", TONE[tone].ink) : TONE[tone].chip)}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}
