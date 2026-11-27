"use client";

// Pieces the screening mock's pages share: the surfaces and chips that tell kinds of things apart, a
// section with its "?", a reviewer's face or model mark, a vote, a paper's result, and the worked
// examples that show what a rule does.

import { type CSSProperties, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from "react";
import PlainLink from "next/link";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, CirclePause, Clock, Coins, ExternalLink, Eye, FileText, GitCompare, Hash, Hourglass, Lock, Mail, MessagesSquare, Minus, Quote, RefreshCw, RotateCcw, Search, TriangleAlert, X, type AppIcon } from "@/components/icons";
import { getModelIcon } from "@/components/icons/provider-icons";
import { Chip, RequiredMark, SOURCE_ICON } from "./parts";
import { tintOf } from "@/components/settings/model-map";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HELP_POPOVER, HelpButton, HelpFact } from "@/components/ui/help";
import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SELECT_TRIGGER } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { useIsMobile } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ANSWERS, settle, type Answer } from "@/lib/screening/rules";
import { useFormatter, useTranslations } from "next-intl";
import { RESULTS, inOrder, questionOf, type Criterion, type Decision, type Paper, type Result, type Reviewer, type Rule, type Vote } from "./data";
import type { ModelsState } from "./store";
import { papersHref } from "./links";
import { useWords } from "./words";
import { ScrollArea } from "@/components/ui/scroll-area";

/** This part's messages, for a function that is handed them. */
type T = ReturnType<typeof useTranslations<"screening.pieces">>;

/**
 * What a screening's models are doing when they are not reading, as a mark: its words are `modelsSay.<state>.says`
 * of the whole screening and `.row` of one model in its own row (`screening.pieces`). One table, so the list, the
 * notice, the Overview and the settings say it alike. `stop` is a state somebody has to act on.
 */
export const MODELS_SAY: Record<Exclude<ModelsState, "reading">, { icon: AppIcon; stop?: true }> = {
  checking: { icon: RefreshCw },
  gathering: { icon: Search },
  paused: { icon: CirclePause, stop: true },
  credits: { icon: Coins, stop: true },
  waiting: { icon: Clock },
};
export const MODELS_READING = (t: T) => t("modelsReading");

/**
 * The "?" beside a label: what the label means, and how the thing works, said once where a person asks
 * for it. The page itself explains nothing in a sentence. `facts` are HelpFact chips under the text.
 * It opens beside its "?" on a wide screen and under it on a phone.
 */
export function Help({ title, children, facts, side, className }: { title: string; children: ReactNode; facts?: ReactNode; /** Where it opens, for a "?" whose usual side would cover what it explains. */ side?: "top" | "bottom" | "left"; className?: string }) {
  const t = useTranslations("screening.pieces");
  const beside = !useIsMobile();
  return (
    <Popover>
      <PopoverTrigger asChild><HelpButton aria-label={t("about", { title })} className={className} /></PopoverTrigger>
      {/* Scrolled out of sight, its "?" takes the explanation with it: it never stays behind over the page, cut off at an edge. */}
      <PopoverContent hideWhenDetached side={side ?? (beside ? "right" : "bottom")} align="start" aria-label={t("about", { title })} className={HELP_POPOVER}>
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

/**
 * Under what stays at the top of the window on a screening's pages: the app's bar, the page's bar and, from a laptop's
 * width, the screening's own strip of tabs (`--screening-frame`, its height, which its frame writes). Nothing above a
 * sidebar or a table's head scrolls away, so where they stick and how tall they may be never depends on how far the
 * page is scrolled. Written out whole, so Tailwind finds them.
 */
export const BELOW_HEADER = "scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+var(--screening-frame,0px)+1rem)]";
export const UNDER_FRAME = "top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+var(--screening-frame,0px))]";

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
/** The icon of the kind of place a screening's papers came from. */
export const kindIcon = (kind: string): AppIcon => (kind === "upload" || kind === "pdf" ? FileText : kind === "dois" ? Hash : SOURCE_ICON[kind === "search" || kind === "collection" || kind === "saved" || kind === "screening" || kind === "evidenceLibrary" || kind === "zotero" ? kind : "collection"]);
/** Each result's icon in its own colour. */
export const RESULT_ICON = Object.fromEntries(RESULTS.map((result) => [result, tinted(RESULT_STYLE[result].icon, RESULT_STYLE[result].tone)])) as Record<Result, ComponentType<{ className?: string }>>;
/** A count in a tab, in the colour of what it counts while there is any: what waits for you is primary, a conflict is blue. */
export function TabCount({ value, tone = "neutral" }: { value: number; tone?: Tone }) {
  const words = useWords();
  return <span className={cn("tabular-nums", value ? TONE[tone].ink : "text-muted-foreground")}>{words.num(value)}</span>;
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

/**
 * The rules that keep a part of a paper from the person looking, each with its sign and the words for what opens it.
 * A part a rule shuts is never left out, and is drawn one way wherever it is: the rule's chip beside the part's title,
 * and one line in the part's place that says what is there and why it is shut. The words are here, so the chip, the
 * "?" and a vote's mark all say the rule the same way: the vote's is `screening.words.hiddenUntilVote`, the others'
 * `shut.<rule>` here.
 */
export const SHUT = {
  vote: { icon: Lock },
  // Who the person is to the screening: its reviewers vote and write, and one person settles its conflicts.
  reviewer: { icon: Eye },
  settler: { icon: Eye },
  // Changing who is on it and its settings is for the members of its workspace.
  member: { icon: Lock },
  // A living screening whose sources hold what they held: a file, a pasted list.
  sources: { icon: Lock },
} as const;
/** What someone who doesn't vote on a screening is told where a vote would be cast: what they are to it, and what would change that, where something would. */
export const notReviewerSays = (t: T, member: boolean, finished: boolean) => (!member ? t("notReviewer.shared") : finished ? t("notReviewer.finished") : t("notReviewer.join"));
export type Shut = keyof typeof SHUT;

/** Beside the title of a part a rule shuts, or beside a control it shuts: what opens it. A control is not hidden, so it says when it opens in its own words. */
export function ShutChip({ by, children }: { by: Shut; children?: ReactNode }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  return <Chip icon={SHUT[by].icon}>{children ?? (by === "vote" ? words.t("hiddenUntilVote") : t(`shut.${by}`))}</Chip>;
}

/** In the place of a part a rule shuts: what is there and why it is shut, in a line that never repeats the chip. */
export function ShutNote({ by, children }: { by: Shut; children: ReactNode }) {
  return <Note icon={SHUT[by].icon}>{children}</Note>;
}

/** A line that says how something stands, with its sign: the one grey box for it, whatever it is about. */
export function Note({ icon: Icon, children }: { icon: AppIcon; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-inset px-3 py-3 text-sm text-muted-foreground">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A paper's reviewers in the order every table of its votes shows them: the person looking, then the other people, then the models. */
export const youFirst = <T extends { reviewer: Pick<Reviewer, "id" | "kind"> }>(cast: T[], me: string) => {
  const order = inOrder(cast.map((one) => one.reviewer), me);
  return [...cast].sort((a, b) => order.indexOf(a.reviewer) - order.indexOf(b.reviewer));
};

/** The line under the others' votes while the rule hides them, on Screen and in the Papers drawer. */
export const VOTES_SHUT = (t: T) => t("votesShut");

/**
 * Sends a model back to the papers it couldn't read: the one control for it, wherever a failed read shows, with the
 * same words and the same price. Where the workspace can't pay for it, it is shut and says how many credits are missing.
 */
export function RetryRead({ papers, cost, short, onRetry, variant = "outline", size = "xs", className }: { papers: number; /** In credits, as it is said. */ cost: string; /** The credits missing, as they are said, or nothing where there are enough. */ short?: string; onRetry: () => void; variant?: "default" | "outline"; size?: "xs" | "sm"; className?: string }) {
  const t = useTranslations("screening.pieces");
  return (
    <span className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button variant={variant} size={size} disabled={Boolean(short)} className={cn(variant === "default" && "min-w-0 flex-1")} onClick={onRetry}><RotateCcw />{retryLabel(t, papers, cost)}</Button>
      {short ? <StateChip tone="warning" icon={Coins}>{t("creditsShort", { short })}</StateChip> : null}
    </span>
  );
}
/** What that control says, for a menu's row too. */
export const retryLabel = (t: T, papers: number, cost: string) => t("retry", { papers: Math.max(1, papers), cost });

/** A figure that opens the papers it counts: underlined at rest, so it is told apart from a figure that only says how many. */
/** A name or a count inside a sentence that opens something: underlined where it stands, so it reads as a link before the pointer is on it. */
export const INLINE_LINK = "rounded-sm font-medium text-foreground underline decoration-foreground/25 underline-offset-2 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50";
export const FIGURE_LINK = "underline decoration-current/35 underline-offset-[3px]";

/** A paper's authors, journal and year under its title where the paper is open, as a reference gives them. Nothing where it has none of the three. */
export function Byline({ paper }: { paper: Pick<Paper, "authors" | "venue" | "year"> }) {
  if (!paper.authors?.length && !paper.venue && !paper.year) return null;
  return <p className="text-sm text-muted-foreground">{paper.authors?.length ? `${paper.authors.join(", ")}. ` : null}{paper.venue ? <span className="italic">{paper.venue}</span> : null}{paper.venue && paper.year ? ", " : null}{paper.year}</p>;
}

/** What a link to one reviewer's votes is called, wherever one is. */
export const votesBy = (t: T, reviewer: Pick<Reviewer, "id" | "name">, me: string | undefined) => t("votesBy", { you: String(reviewer.id === me), name: reviewer.name });

type FaceLink = { href: string; says: string; /** One of the reviewers the row is narrowed to: it stands out, and the others fade. */ on?: boolean };
/**
 * Reviewers' faces in a row, overlapped: one row for the list, the bar over a screening, the settings' summary and a
 * paper's "waiting on". As many as `max` show, then how many more, which opens them all where `more` says where.
 * With `linkOf` each face is a link, named by what it opens. Without it the row is a picture of who is on something.
 */
export function Faces({ reviewers, me, max = 6, linkOf, more, mark, className }: { reviewers: Reviewer[]; me: string | undefined; max?: number; linkOf?: (reviewer: Reviewer) => FaceLink; more?: FaceLink; /** The size of a face, where the row has less room than a face's own. */ mark?: string; className?: string }) {
  const words = useWords();
  const faces = reviewers.slice(0, max);
  const links = linkOf ? faces.map(linkOf) : [];
  const narrowed = links.some((link) => link.on);
  const hidden = reviewers.length - faces.length;
  return (
    <span aria-hidden={linkOf ? undefined : true} className={cn("flex shrink-0 items-center", className)}>
      {faces.map((reviewer, i) => {
        const shape = cn("flex ring-2 ring-card", reviewer.kind === "model" ? "rounded-md" : "rounded-full", i > 0 && "-ms-1.5");
        const face = <ReviewerMark reviewer={reviewer} you={reviewer.id === me} className={mark} />;
        const link = links[i];
        if (!link) return <span key={reviewer.id} className={shape}>{face}</span>;
        return (
          <TooltipHint key={reviewer.id} label={link.says}>
            <NextLink href={link.href} aria-label={link.says} aria-current={link.on ? "true" : undefined} className={cn("relative outline-none transition-[transform,opacity] hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:ring-ring/60 motion-reduce:transition-none", shape, narrowed && (link.on ? "z-10 -translate-y-0.5 ring-foreground" : "opacity-40 hover:opacity-100 focus-visible:opacity-100"))}>
              {face}
            </NextLink>
          </TooltipHint>
        );
      })}
      {hidden > 0 ? (
        more ? (
          <TooltipHint label={more.says}>
            <NextLink href={more.href} aria-label={more.says} className="relative ms-1.5 rounded-md px-0.5 text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">+{words.num(hidden)}</NextLink>
          </TooltipHint>
        ) : <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">+{words.num(hidden)}</span>
      ) : null}
    </span>
  );
}

/** A chip that opens something: the tint of what it says, an arrow at its end, and a fuller tint under the pointer. Every chip that can be pressed is one of these, so a chip without the arrow is never a button. */
/** The papers a screening still has open, as two counts that open them on Papers: in conflict, and waiting for votes. */
export function OpenPapersChips({ id, conflict, waiting, onClick }: { id: string; conflict: number; waiting: number; onClick?: () => void }) {
  const t = useTranslations("screening.pieces");
  return (
    <span className="flex flex-wrap gap-1.5">
      {conflict ? <LinkChip href={papersHref(id, { result: "conflict" })} tone="info" icon={GitCompare} onClick={onClick}>{t("openPapers.conflict", { count: conflict })}</LinkChip> : null}
      {waiting ? <LinkChip href={papersHref(id, { result: "waiting" })} icon={Hourglass} onClick={onClick}>{t("openPapers.waiting", { count: waiting })}</LinkChip> : null}
    </span>
  );
}

export function LinkChip({ href, tone = "neutral", icon, children, className, elsewhere = false, ...link }: Omit<ComponentProps<typeof NextLink>, "children"> & { tone?: Tone; icon?: AppIcon; children: ReactNode; /** It leads into another workspace: its address is taken as it is, where any other link stays in the workspace the page is in. */ elsewhere?: boolean }) {
  const Link = elsewhere ? PlainLink : NextLink;
  return (
    <Link {...link} href={href} className={cn("flex min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>
      <Chip icon={icon} className={cn(TONE[tone].chip, TONE[tone].hover, "min-w-0 shrink pe-1 font-medium transition-colors")}>
        <span className="truncate">{children}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 opacity-60" />
      </Chip>
    </Link>
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
 * Where a sidebar stands beside the main content, and from there scrolls on its own. Each is the width at which its
 * page lays the two side by side: narrower than that the sidebar is one more block of the page, with no height of its
 * own. Written out whole, so Tailwind finds them.
 */
/** A filter's pill while it narrows its list: tinted as the open tab beside it is. */
export const FILTER_ON = "border-primary/30 bg-primary/8 hover:bg-primary/12";
/** One thing to pick in a FilterMenu: its sign, its name, and how many papers it holds. `tone` is its colour role, for its sign and its count: a vote's is its result's. Choices that share a `group` sit under its name. */
export type Choice<T extends string> = { value: T; label: string; icon?: ReactNode; tone?: Tone; count?: number; group?: string; /** A rule shuts this choice: it stays in the menu, with the reason, and can't be picked. */ shut?: string };
// A menu row and a select's pill both turn every icon grey. A choice's sign takes its tone instead.
const SIGN = "flex items-center [&_svg]:text-current!";

/**
 * A choice of one in a bar, as a pill: what it sets and the choice made, and under it a menu of the choices,
 * each with its sign, its name and how many papers it holds. The first choice is the one that leaves the list
 * whole. With any other the pill is tinted and carries the choice's sign, so the bar shows what is narrowing its
 * list. `narrows={false}` is for a choice that narrows nothing, such as an order: its pill is never tinted.
 * `lead` is a sign before the name, where the name alone doesn't say what the pill is for.
 */
export function FilterMenu<T extends string>({ name, lead, value, onChange, choices, narrows = true, align = "start", className }: { name: string; lead?: ReactNode; value: T; onChange: (next: T) => void; choices: Choice<T>[]; narrows?: boolean; align?: "start" | "end"; className?: string }) {
  const t = useTranslations("screening.pieces");
  const picked = choices.find((one) => one.value === value) ?? choices[0]!;
  const changed = picked !== choices[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-slot="select-trigger" data-size="sm" aria-label={t("filterLabel", { name, choice: picked.label })} className={cn(SELECT_TRIGGER, narrows && changed && FILTER_ON, className)}>
          <span className="flex min-w-0 items-center gap-1.5">
            {lead}
            <span className="text-muted-foreground">{name}</span>
            <span className="flex min-w-0 items-center gap-1.5 font-medium">{/* A filter left at its first choice narrows nothing and shows no sign. Where every choice is a real one, the one picked always shows its own. */}{(changed || !narrows) && picked.icon ? <span className={cn(SIGN, TONE[picked.tone ?? "neutral"].ink)}>{picked.icon}</span> : null}<span className="truncate">{picked.label}</span></span>
          </span>
          <ChevronDown className="size-4 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      {/* A choice may be a person: their face fades in, as in every part that opens over the page. */}
      <DropdownMenuContent align={align} className={cn("w-auto max-w-[min(26rem,calc(100vw-2rem))] min-w-[max(14rem,var(--radix-dropdown-menu-trigger-width))]", AVATARS_FADE_IN)}>
        {[...new Set(choices.map((one) => one.group))].map((group, i) => (
          <div key={group ?? ""} role="group" aria-label={group}>
            {i ? <DropdownMenuSeparator /> : null}
            {group ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{group}</DropdownMenuLabel> : null}
            {choices.filter((one) => one.group === group).map((one) => (
              // A long name runs onto a second line, and the sign, the count and the tick stay on its first.
              <DropdownMenuItem key={one.value} role="menuitemradio" aria-checked={one.value === value} disabled={Boolean(one.shut)} onSelect={() => onChange(one.value)} className="items-start data-[disabled]:opacity-100">
                {one.icon ? <span className={cn(SIGN, "h-5", TONE[one.tone ?? "neutral"].ink, one.shut && "opacity-50")}>{one.icon}</span> : null}
                <span className="min-w-0 flex-1"><span className={cn(one.shut && "opacity-50")}>{one.label}</span>{/* The lock sits on the reason's first line, in a box one line high, however far the reason runs. */}{one.shut ? <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground"><span className="flex h-4 shrink-0 items-center"><Lock aria-hidden className="size-3" /></span>{one.shut}</span> : null}</span>
                {one.count !== undefined ? <span className="ps-3 text-xs leading-5"><span className="sr-only">, </span><TabCount value={one.count} tone={one.tone} /></span> : null}
                <span className="flex h-5 items-center"><Check aria-hidden className={cn("size-4", one.value !== value && "invisible")} /></span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The 1.5rem taken off the height is the page's own padding over its card, the one thing over a sidebar that scrolls away.
const SIDEBAR = "@6xl:sticky @6xl:top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+var(--screening-frame,0px))] @6xl:max-h-[calc(100dvh-var(--app-navbar-height)-var(--page-header-height,4rem)-var(--screening-frame,0px)-var(--clear)-1.5rem)]";

/**
 * A sidebar: a column beside a page's main content, where the page itself scrolls. It stays under what is held at
 * the window's top, reaches to the window's foot and no further, and where what it holds is taller than that it
 * scrolls on its own. It must stand right under that held top, with nothing over it that scrolls away: that is what
 * makes its height the same however far the page is scrolled, with no measuring. The main content is never given a
 * height: it is as long as it is, and the page scrolls. A sidebar is a tool beside the content, such as a form's
 * summary. Blocks of a page's own content laid in two columns, as on the Overview, are not one, and scroll with the
 * page. A page that fits the window whole, as Screen does, has panes instead (LibraryPageShell's `fill`).
 * `clear`: the room kept under it for an ActionBar at the window's foot.
 *
 * The padding around what it holds goes on the sidebar itself (`className`), never on a box around it. A box that
 * scrolls down also scrolls sideways as soon as anything in it reaches past its padding, and a row's hover fill
 * that hangs a few pixels out of its text does. With the padding inside, that fill lands in it.
 */
export function StickyColumn({ clear = "1rem", className, children }: { clear?: string; className?: string; children: ReactNode }) {
  return (
    // The column sticks and takes its height; what scrolls is the area inside it, which positions itself and so can't be the one that sticks.
    <div style={{ "--clear": clear } as CSSProperties} className={cn("flex flex-col self-start", SIDEBAR)}>
      <ScrollArea shades className="min-h-0 flex-1"><div className={className}>{children}</div></ScrollArea>
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
  // `data-action-bar` lifts the app's toasts above it (app/globals.css): one over the bar hid the button it was about.
  return <div data-action-bar {...rest} className={cn("sticky bottom-0 z-20 border-t border-border-subtle bg-card shadow-[0_-10px_30px_-22px_rgb(0_0_0/0.3)]", className)} />;
}

/** A small tag after a name, as "You" is drawn: what kind of reviewer it is, or that they were taken off. */
const NAME_TAG = "shrink-0 rounded-full bg-foreground/[0.07] px-2 text-2xs font-normal leading-5 text-muted-foreground";
/** A reviewer's name with what kind of reviewer it is: You after your own, AI after a model's. One marker, the same on every page. */
export function ReviewerName({ reviewer, you = false, wrap = false, className }: { reviewer: Pick<Reviewer, "kind" | "name" | "model"> & { left?: number }; you?: boolean; /** In a table's row, where a second line costs nothing: a name too long for its column runs onto one and is read whole. */ wrap?: boolean; className?: string }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  // One model on it at two efforts: the effort is all that tells the two apart, and a narrow column cuts a name at its end. It stands beside the model's own name, where it is never cut.
  const effort = words.twinEffort(reviewer);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {/* A name cut short by its column is read in full on hover. */}
      <TooltipHint label={reviewer.name} onlyWhenClipped={!effort}><span className={wrap ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate"}>{effort ? reviewer.model!.name : reviewer.name}</span></TooltipHint>
      {/* An effort is said of a model only: it takes the place of the tag that says a reviewer is one. */}
      {you ? <YouTag /> : effort ? <span className={NAME_TAG}>{effort}</span> : reviewer.kind === "model" ? <span className={NAME_TAG}>{t("tag.ai")}</span> : null}
      {/* Someone taken off the screening whose vote still stands on this paper: said beside their name, so nobody looks for them among the reviewers. */}
      {reviewer.left ? <span className={NAME_TAG}>{t("tag.takenOff")}</span> : null}
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

/** One vote as a small square with its sign. `hidden` is a vote cast but not shown yet, to someone who hasn't voted. */
export function VoteMark({ vote, hidden = false, failed = false, settled = false, who, className }: { vote?: Pick<Vote, "decision">; hidden?: boolean; failed?: boolean; /** The paper is settled for good: a place with no vote in it waits for nobody. */ settled?: boolean; who: string; className?: string }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  if (failed) {
    return (
      <TooltipHint label={t("voteMark.failed", { who })}>
        <span role="img" tabIndex={0} aria-label={t("voteMark.failed", { who })} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-destructive text-white", className)}>
          <TriangleAlert aria-hidden className="size-3.5" />
        </span>
      </TooltipHint>
    );
  }
  // A vote kept from the person looking: that it was cast, and nothing of how.
  if (hidden) {
    return (
      <span role="img" aria-label={t("voteMark.hidden", { who })} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}>
        <Lock aria-hidden className="size-3" />
      </span>
    );
  }
  if (!vote) {
    return (
      <span role="img" aria-label={t(settled ? "voteMark.none" : "voteMark.yet", { who })} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground", className)}>
        {settled ? <Minus aria-hidden className="size-3" /> : <Hourglass aria-hidden className="size-3" />}
      </span>
    );
  }
  const { icon: Icon, chip } = RESULT_STYLE[vote.decision];
  return (
    <span role="img" aria-label={t("voteMark.cast", { who, decision: words.decision(vote.decision) })} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", chip, className)}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** Where a paper stands, as a chip. */
export function ResultChip({ result, className }: { result: Result; className?: string }) {
  const words = useWords();
  const { icon: Icon, chip } = RESULT_STYLE[result];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium", chip, className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {words.result(result)}
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

/**
 * For a part that opens and closes by growing from no height and shrinking back to it, where it is a row of a divided
 * list. The list draws a line under each of its rows, and at no height that line still takes a pixel, until the row has
 * left: the jump in the last frame of closing. So the row gives the pixel back with a margin and holds one inside
 * instead, which shrinks with the rest. Closed, it takes no room at all.
 *
 * The same goes for any space a parent puts around its children. In a flex parent with a gap, the part's wrapper takes
 * the gap off with a negative margin (`-mt-3` in a `gap-3`) and its content carries it as padding (`pt-3`). A grid's gap
 * can't be taken off that way, since a row's track never goes below nothing: there the rows are set apart by their
 * cells' margins and the part has none (the votes table in screen.tsx).
 */
export const DIVIDED_ROW = "-mb-px after:block after:h-px";

/** A fact with its name: the name quiet, the fact in the text's own weight. What "Name: fact" would say, drawn with weight in place of a colon. */
export function Named({ name, children }: { name: string; children: ReactNode }) {
  return <><span className="shrink-0 font-normal text-muted-foreground">{name}</span><span className="min-w-0 truncate">{children}</span></>;
}

/**
 * Why a paper was excluded, or what a Maybe is unclear on, drawn in place of "Not met: name": the criterion's short name
 * behind the sign its answer has, a red cross for one not met and an amber dash for one left unclear. A reason that is
 * not a criterion is its own words.
 */
export function Reason({ reason, criteria, unclear = false, wrap = false, className }: { reason: string; criteria: Criterion[]; unclear?: boolean; /** In a row to press, where there is room: the name runs onto a second line and is read whole. */ wrap?: boolean; className?: string }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  const criterion = criteria.find((one) => one.key === reason);
  if (!criterion) return <span className={cn("truncate", className)}>{words.reason(reason, criteria)}</span>;
  const { icon: Icon, tone } = ANSWER_SIGN[unclear ? "unclear" : "no"];
  // A name nobody wrote is the question's own words cut short: the question is shown instead, and the room it stands in cuts it where it must, with the rest a hover away.
  const name = words.criterionLabel(criterion);
  return (
    <span className={cn("inline-flex min-w-0 max-w-full gap-1", wrap ? "items-start" : "items-center", className)}>
      <Icon role="img" aria-label={t(unclear ? "reasonSign.unclear" : "reasonSign.no")} className={cn("size-3.5 shrink-0", wrap && "mt-0.5", TONE[tone].ink)} />
      <span className={wrap ? "[overflow-wrap:anywhere]" : "truncate"}>{name}</span>
    </span>
  );
}

/** Waiting is hatched wherever it is drawn, so papers still to be voted on never read as excluded ones. */
export const HATCH = "bg-[repeating-linear-gradient(-45deg,transparent_0_3px,color-mix(in_oklab,var(--foreground)_14%,transparent)_3px_5px)]";

/** A screening's papers as one bar, split by where they stand. With `hrefOf`, each part opens its papers and says its own count. */
export function ResultBar({ counts, className, hrefOf }: { counts: Record<Result, number>; className?: string; hrefOf?: (result: Result) => string }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  const format = useFormatter();
  const total = RESULTS.reduce((sum, result) => sum + counts[result], 0);
  const says = (result: Result) => t("resultCount", { result, count: counts[result] });
  const part = (result: Result) => cn("h-full min-w-1.5 basis-0 duration-500 ease-out motion-reduce:transition-none", RESULT_STYLE[result].bar, result === "waiting" && HATCH);
  const none = total === 0 ? <span className="h-full flex-1 rounded-full bg-foreground/10" /> : null;
  if (hrefOf) {
    return (
      <span className={cn("flex h-2.5 w-full gap-px rounded-full", className)}>
        {none}
        {RESULTS.map((result) =>
          counts[result] ? (
            <TooltipHint key={result} label={says(result)}>
              {/* The part's hit area runs above and below the thin bar. */}
              <NextLink href={hrefOf(result)} aria-label={says(result)} className={cn(part(result), "relative outline-none transition-[flex-grow,filter] first:rounded-s-full last:rounded-e-full after:absolute after:inset-x-0 after:-inset-y-2 hover:brightness-90 focus-visible:ring-2 focus-visible:ring-ring/50")} style={{ flexGrow: counts[result] }} />
            </TooltipHint>
          ) : null,
        )}
      </span>
    );
  }
  // A list with commas and no "and": the language's own unit list.
  const label = format.list(RESULTS.filter((result) => counts[result]).map(says), { type: "unit" }) || words.t("empty.all");
  return (
    <TooltipHint label={label}>
      <div role="img" aria-label={label} tabIndex={0} className={cn("flex h-2.5 w-full gap-px overflow-hidden rounded-full", className)}>
        {none}
        {RESULTS.map((result) => (counts[result] ? <span key={result} className={cn(part(result), "transition-[flex-grow]")} style={{ flexGrow: counts[result] }} /> : null))}
      </div>
    </TooltipHint>
  );
}

/** How a paper's reviewers voted, as a count beside each decision's mark. */
export function Tally({ votes, className }: { votes: Array<Pick<Vote, "decision">>; className?: string }) {
  const t = useTranslations("screening.pieces");
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {(["include", "maybe", "exclude"] as const).map((decision) => {
        const n = votes.filter((vote) => vote.decision === decision).length;
        const Icon = RESULT_STYLE[decision].icon;
        return n ? (
          <span key={decision} role="img" aria-label={t("tally", { decision, count: n })} className={cn("flex items-center gap-1 text-xs font-medium tabular-nums", TONE[RESULT_STYLE[decision].tone].ink)}>
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
  // Written in whatever language its author wrote it in: it keeps its own direction on a page read right to left.
  if (!must) return <bdi>{text}</bdi>;
  const at = text.lastIndexOf(" ");
  return <bdi>{text.slice(0, at + 1)}<span className="whitespace-nowrap">{text.slice(at + 1)}<RequiredMark /></span></bdi>;
}

/**
 * What a rule does, shown on three made-up papers: the votes a paper might get, an arrow, and where
 * that leaves it. It stands in for a paragraph of explanation.
 */
export function RuleExamples({ rule, each, models }: { rule: Rule; each: number; models: number }) {
  const t = useTranslations("screening.pieces");
  const votes = Math.max(1, models + each);
  // The people's votes first, then the models': settled by the rule itself, as a real paper is.
  const row = (decisions: Array<Decision | null>): Result => settle(rule.settle, decisions.map((decision, at) => ({ kind: at < each ? ("person" as const) : ("model" as const), ...(decision ? { status: "cast" as const, decision, at } : { status: "waiting" as const }) })), rule.models);
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
            {decisions.slice(0, 6).map((decision, n) => <VoteMark key={n} vote={decision ? { decision } : undefined} who={t("reviewerN", { n: n + 1 })} className="size-5" />)}
          </span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <ResultChip result={row(decisions)} />
        </div>
      ))}
    </div>
  );
}

/** An answer to a criterion, with its sign. Its name is `answer.<answer>` here. Unclear is a dash, never a "?", which is help. */
export const ANSWER_SIGN: Record<Answer, { icon: AppIcon; tone: Tone }> = { yes: { icon: Check, tone: "success" }, no: { icon: X, tone: "destructive" }, unclear: { icon: Minus, tone: "warning" } };

/** One answer as a small square with its sign. `label` names whose answer it is, or to which criterion. */
export function AnswerMark({ answer, label, pressable = false }: { answer: Answer; label: string; /** Drawn as a button, outlined on the card's white: for an answer that opens something. One that opens nothing is a flat tint. */ pressable?: boolean }) {
  const t = useTranslations("screening.pieces");
  const { icon: Icon, tone } = ANSWER_SIGN[answer];
  return (
    <span role="img" aria-label={t("answerMark", { label, answer: t(`answer.${answer}`) })} className={cn("inline-flex size-6 items-center justify-center rounded-md", pressable ? cn("border border-current/45 bg-card shadow-xs", TONE[tone].ink) : TONE[tone].chip)}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** "Answers differ", beside a criterion its reviewers answered differently: a chip that is pressed, and opens the answer that stands apart. In no result's colour: answers that differ are not a paper in conflict, which only its votes make. */
export const DIFFER = "flex h-5 items-center gap-0.5 whitespace-nowrap rounded-full bg-foreground/[0.07] ps-1.5 pe-1 text-2xs font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.12] focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * What a paper's table of votes shows, behind its "?": the same on Screen and in the Papers drawer, with every sign the
 * table draws. The rule that hides votes is named only on a screening that has it.
 */
export function VotesHelp({ blind, side }: { blind: boolean; side?: "top" | "bottom" | "left" }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  return (
    <Help
      title={t("votesHelp.title")}
      side={side}
      facts={
        <>
          <HelpFact icon={Hourglass}>{words.t("noVoteSays.yet")}</HelpFact>
          <HelpFact icon={Minus}>{words.t("noVoteSays.none")}</HelpFact>
          <HelpFact icon={TriangleAlert}>{words.t("noVoteSays.failed")}</HelpFact>
          {ANSWERS.map((answer) => <HelpFact key={answer}><span className="-ms-1 flex scale-75"><AnswerMark answer={answer} label={t("votesHelp.anAnswer")} /></span>{t(`answer.${answer}`)}</HelpFact>)}
          <HelpFact><span aria-hidden className="-ms-0.5 size-4 rounded-md border border-dashed border-border" />{t("votesHelp.noAnswer")}</HelpFact>
          <HelpFact><span className={cn(DIFFER, "-ms-1 h-4")}>{t("votesHelp.answersDiffer")}<ChevronDown aria-hidden className="size-3" /></span>{t("votesHelp.answeredDifferently")}</HelpFact>
          <HelpFact><span className="-ms-1 flex scale-75"><AnswerMark answer="yes" label={t("votesHelp.anAnswer")} pressable /></span>{t("votesHelp.opensAnswer")}</HelpFact>
        </>
      }
    >
      <p>{t("votesHelp.body")}</p>
      {/* The rule, said for anyone who reads this: someone who never votes here sees every vote, and is promised no lock. */}
      {blind ? <p>{words.t("votesHiddenSays")} {t("votesHelp.lock")}</p> : null}
    </Help>
  );
}

/**
 * Include, Maybe or Exclude as a button: the one look for casting a vote and for settling a result, on Screen, in the
 * Papers drawer and over a selection. It has its decision's colour, and is filled once chosen: under the pointer an
 * unchosen one only darkens its border, so it never reads as chosen. `pointed` outlines it dashed, where a person's
 * answers point to it. What follows its name (a key) is its children.
 */
export function VoteButton({ decision, on = false, pointed = false, size = "lg", className, children, ...rest }: Omit<ComponentProps<"button">, "type"> & { decision: Decision; on?: boolean; pointed?: boolean; size?: "lg" | "sm" }) {
  const words = useWords();
  const Icon = RESULT_STYLE[decision].icon;
  const look = {
    include: on ? "bg-success text-success-foreground" : "border-success/35 ink-success hover:border-success/70",
    maybe: on ? "bg-warning text-warning-foreground" : "border-warning/40 ink-warning hover:border-warning/80",
    exclude: on ? "bg-destructive text-destructive-foreground" : "border-destructive/30 ink-destructive hover:border-destructive/60",
  }[decision];
  return (
    <button {...rest} type="button" aria-pressed={on} className={cn("flex items-center justify-center border font-semibold transition-colors", size === "lg" ? "h-10 w-full gap-1.5 rounded-xl text-sm" : "h-7 gap-1 rounded-lg px-2.5 text-xs", look, on && "border-transparent", !on && pointed && "border-dashed border-current", className)}>
      <Icon className={size === "lg" ? "size-4" : "size-3.5"} />
      {words.decision(decision)}
      {children}
    </button>
  );
}

/** One reason to exclude as a list of them names it: a must-have by its short name, with its whole question under it where `asked` and the name isn't the question, and another reason in its own words. */
export function ReasonLabel({ reason, criteria, asked = false }: { reason: string; criteria: Criterion[]; asked?: boolean }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  if (!criteria.some((criterion) => criterion.key === reason)) return <>{reason === "other" ? t("anotherReason") : words.reason(reason, criteria)}</>;
  // Under a name someone wrote, the question it stands for. A name nobody wrote is shown as its question already.
  const question = asked ? questionOf(reason, criteria, "label") : undefined;
  return (
    <span className="min-w-0">
      <Reason reason={reason} criteria={criteria} wrap />
      {question ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{question}</span> : null}
    </span>
  );
}

/** The reasons to exclude as rows to press, in their two groups: in the sheet a phone opens on Screen, in the Papers drawer and over a selection. */
export function ReasonRows({ criteria, many = false, onPick }: { criteria: Criterion[]; /** The reason is for several papers picked together. */ many?: boolean; onPick: (reason: string) => void }) {
  const words = useWords();
  return (
    <>
      {words.excludeGroups(criteria, many).map((group) => (
        <div key={group.name} role="group" aria-label={group.name} className="space-y-1.5">
          <p className="px-1 text-xs font-medium text-muted-foreground">{group.name}</p>
          {group.list.map((reason) => (
            <button key={reason.key} type="button" onClick={() => onPick(reason.key)} className="flex min-h-11 w-full items-center rounded-xl border border-border-subtle bg-card px-3 py-2 text-start text-sm transition-colors hover:bg-muted"><ReasonLabel reason={reason.key} criteria={criteria} asked /></button>
          ))}
        </div>
      ))}
    </>
  );
}

/** "Nothing here yet", where a list or a part of a page is empty: one dashed box, the same wherever it stands. */
export function EmptyNote({ className, ...rest }: ComponentProps<"p">) {
  return <p {...rest} className={cn("rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground", className)} />;
}

/**
 * The facts under a paper's title, the same on Screen and in the Papers drawer: where it came from, when it was added
 * if that was after the start, how often it is cited, and the way to its full text. The first two open the papers that
 * share them, and are tinted while the table is narrowed to them.
 */
export function PaperFacts({ paper, source, added }: {
  paper: Pick<Paper, "title" | "cited" | "doi" | "pdf">;
  source?: { name: string; kind: string; href: string; on?: boolean; current?: "true"; label?: string };
  added?: { at: number; href: string; on?: boolean; current?: "true" };
}) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  return (
    <>
      {/* Where the paper came from, said as that: a search's name is its query, which was taken for a label on the paper. */}
      {source ? <LinkChip href={source.href} aria-current={source.current} aria-label={source.label} tone={source.on ? "primary" : "neutral"} icon={kindIcon(source.kind)} className="max-w-80 [&>span]:shrink">{t("paperFacts.from", { name: source.name })}</LinkChip> : null}
      {added ? <LinkChip href={added.href} aria-current={added.current} tone={added.on ? "primary" : "neutral"} icon={RefreshCw}>{t("paperFacts.added", { ago: words.ago(added.at) })}</LinkChip> : null}
      {paper.cited === undefined ? null : <Chip icon={Quote}>{t("paperFacts.cited", { count: paper.cited })}</Chip>}
      {/* Its DOI opens the paper where it is published; without one, a search for its title finds it. In a new tab, so the place in the list is kept. A paper screened as its PDF has its full text on the page already. */}
      {paper.pdf ? null : <LinkChip href={paper.doi ? `https://doi.org/${paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : `/results?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noreferrer" icon={ExternalLink}>{t("paperFacts.fullText")}</LinkChip>}
    </>
  );
}

/**
 * One reviewer's place on a paper, as every list, popover and card that names it shows it: their decision with the
 * reason on Exclude and when they voted, and under it the note they left, in quotes. A place with no vote in it says why.
 */
export function VoteFacts({ vote, failed = false, kept = false, settled = false, criteria, children }: { vote: Vote | undefined; failed?: boolean; /** They voted, and how is kept from the person looking. */ kept?: boolean; /** The paper was settled, so a place nobody voted from never will be. */ settled?: boolean; criteria: Criterion[]; /** What else stands with the decision: the answer a card is about. */ children?: ReactNode }) {
  const t = useTranslations("screening.pieces");
  const words = useWords();
  const style = vote ? RESULT_STYLE[vote.decision] : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {failed ? (
          <StateChip tone="destructive" icon={TriangleAlert}>{words.t("noVote.failed")}</StateChip>
        ) : kept ? (
          <ShutChip by="vote">{t("votedHidden")}</ShutChip>
        ) : vote && style ? (
          <StateChip tone={style.tone} icon={style.icon}>{words.decision(vote.decision)}</StateChip>
        ) : (
          <Chip icon={settled ? Minus : Hourglass}>{words.t(settled ? "noVote.none" : "noVote.yet")}</Chip>
        )}
        {!kept && vote?.reason ? <ReasonChip reason={vote.reason} criteria={criteria} /> : null}
        {children}
        {!kept && vote ? <Chip>{words.ago(vote.at)}</Chip> : null}
      </div>
      {!kept && vote?.note ? <p className="text-sm text-muted-foreground">{words.quoted(vote.note)}</p> : null}
    </>
  );
}

/** The reason a vote or a result excludes a paper, as a chip: the criterion it fails by its short name, with the whole question for whoever asks. The same chip wherever a reason shows. */
export function ReasonChip({ reason, criteria, className }: { reason: string; criteria: Criterion[]; className?: string }) {
  const words = useWords();
  return <QuestionName question={questionOf(reason, criteria, "label")} label={words.failed(reason, criteria)} className={cn("inline-flex", className)}><Chip className="min-w-0 shrink"><Reason reason={reason} criteria={criteria} /></Chip></QuestionName>;
}

/** To the paper before and the one after, with their keys: the same pair in Screen's bar and at the head of the Papers drawer. */
export function PaperStepper({ onStep, canPrevious, canNext }: { onStep: (by: 1 | -1) => void; canPrevious: boolean; canNext: boolean }) {
  const t = useTranslations("screening.pieces");
  return (
    <>
      <TooltipHint label={<span className="flex items-center gap-2">{t("previousPaper")}<Kbd className="pointer-coarse:hidden">K</Kbd></span>}><Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={t("previousPaper")} aria-keyshortcuts="k ArrowLeft" disabled={!canPrevious} onClick={() => onStep(-1)}><ChevronLeft /></Button></TooltipHint>
      <TooltipHint label={<span className="flex items-center gap-2">{t("nextPaper")}<Kbd className="pointer-coarse:hidden">J</Kbd></span>}><Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={t("nextPaper")} aria-keyshortcuts="j ArrowRight" disabled={!canNext} onClick={() => onStep(1)}><ChevronRight /></Button></TooltipHint>
    </>
  );
}

/** The way to what reviewers wrote about a paper, with how much there is: one chip wherever it stands. With nothing written yet it invites the first line. */
export function DiscussionLink({ count, writes = true, onClick }: { count: number; /** Whether the person looking may write there: with nothing written, someone who can't is offered nothing. */ writes?: boolean; onClick: () => void }) {
  const t = useTranslations("screening.pieces");
  if (!count && !writes) return null;
  return (
    <button type="button" onClick={onClick} className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50">
      <MessagesSquare aria-hidden className="size-3.5" />
      {count ? t("messages", { count }) : t("discuss")}
    </button>
  );
}
