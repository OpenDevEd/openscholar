# OpenScholar design language — notes for the Evidence Library pages

Short list of what real pages actually do. Every line has a file reference.
Use this to keep the prototype pages looking native.

## Page shell

- Page body: `PageWrapper` > `<div className="container mx-auto p-4 sm:p-6 max-w-6xl">` (`app/history/history-page-client.tsx:11`, `app/pricing/page.tsx:13`, `app/extraction/page.tsx:27`, `app/settings/layout.tsx:75`). `PageWrapper` only adds flex and the footer (`components/PageWrapper.tsx:12`).
- The whole page sits in one raised panel: `CommandCenterContainer` = `rounded-2xl border border-border/50 bg-background/95 dark:bg-background/90 shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]` plus a faint primary gradient wash and a fade-in (`components/command-center/command-center-container.tsx:35-46`).
- Panel header: `px-4 md:px-6 py-5 border-b border-border/40`, icon tile `w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 shadow-sm` with a `blur-xl` glow, `h1 text-xl md:text-2xl font-bold`, `p text-sm text-muted-foreground` (`components/command-center/command-center-header.tsx:33-70`).
- Settings uses the same panel split in two: `aside w-full md:w-64 border-r border-border/40` + main (`app/settings/layout.tsx:76-118`). Sub-page header inside: `px-6 py-5 border-b border-border/40`, `h2 text-lg font-semibold tracking-tight`, `p text-sm text-muted-foreground`; body `p-6 space-y-6 max-w-2xl` (`app/settings/connections/page.tsx:86-94`).
- `components/ui/page-header.tsx` is legacy. Only one real page uses it (`app/results/[searchId]/history/page.tsx:77`). Its gradient-text h1 does not match the rest of the app.

## Sidebar and sticky bars

- App sidebar tokens: `--sidebar`, `--sidebar-accent`, `--sidebar-primary` (`app/globals.css:63-71`). Nav item: `flex items-center gap-3 px-3 py-2.5 rounded-lg`, active `bg-sidebar-accent/80 text-sidebar-primary font-medium` (`components/app-sidebar.tsx:113-125`).
- Settings nav (`components/settings/sidebar-nav.tsx:36-66`): `buttonVariants({variant:"ghost"}) w-full justify-start gap-3`; active `bg-sidebar-accent/80 text-sidebar-primary font-medium shadow-sm`; inactive `text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground`; active left rail `w-1 h-6 bg-gradient-to-b from-primary/80 to-primary/50 rounded-r-full`; icon `h-4 w-4`, `text-primary` when active.
- Sticky bars: `sticky top-0 z-20 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80` (`components/extraction/job-creator.tsx:482`, `components/billing/transactions/transactions-group-header.tsx:40`). Mobile navbar is `h-14 border-b bg-background/95` (`components/mobile-navbar.tsx:18`).

## Cards, rows, sections

- `components/ui/Card` is barely used (about 9 places). Real pages hand-roll these:
  - Sub-panel: `rounded-xl border border-border/50 bg-muted/30 p-4` (`components/billing/credit-balance-card.tsx:34`, `app/settings/billing/page.tsx:411`).
  - List row: `rounded-xl border border-border/50 bg-background p-4 space-y-3` (`app/settings/connections/page.tsx:139`).
  - Section card with a header strip: `overflow-hidden rounded-2xl border-2 border-border/60` > strip `border-b border-border/50 bg-muted/30 px-4 py-3` with `h3 text-sm font-semibold` + `p text-xs text-muted-foreground`, body `p-4 space-y-3` (`app/settings/ai/page.tsx:321-331`, `components/settings/server-model-section.tsx:72-84`).
  - Selectable tile: `rounded-xl border-2 border-border/50 hover:border-border/80 hover:bg-muted/30`, selected `border-l-[4px] border-l-primary bg-primary/5` (`app/settings/ai/page.tsx:346`).
- No shadows on inner cards. Only the outer panel has `shadow-lg`.
- Borders are always soft alpha borders: `border-border/40`, `/50`, `/60`. Never a plain `border`.

## Status colours

- Destructive uses the token. Success, warning, and info use raw palette at `/10` background and `600`/`700` text:
  - Success: `bg-green-500/10 text-green-600` (`app/settings/billing/page.tsx:419`); `text-emerald-600 dark:text-emerald-400` and `bg-emerald-500` dot (`components/extraction/job-list-item.tsx:22-32,184`).
  - Warning: `rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400` (`app/connect/page.tsx:152`, `components/extraction/mixed-success-summary.tsx:76`).
  - Info: `bg-blue-500/10 border-blue-500/20 text-blue-700` (`components/Pricing.tsx:725`).
  - Running: `bg-primary/10 border-primary/20 text-primary`, dot `bg-primary animate-pulse` (`components/Pricing.tsx:717`, `job-list-item.tsx:29`).
- Status chip: `px-2 py-0.5 rounded-full text-xs font-semibold uppercase` (`app/settings/billing/page.tsx:419`). `Badge` base is also a pill (`components/ui/badge.tsx:8`); most uses are `variant="outline"`.
- Error block under a field: `role="alert" rounded-lg border border-destructive/20 bg-destructive/5 p-2.5` with `AlertCircle h-4 w-4 text-destructive` (`app/settings/ai/page.tsx:390-393`). `components/ui/alert.tsx` is not used by real pages.

## Typography and spacing

- Panel h1 `text-xl md:text-2xl font-bold`; sub-page h2 `text-lg font-semibold tracking-tight`; section h3 `text-sm font-semibold`; row title `text-base font-semibold`; empty-state h2 `text-xl font-semibold tracking-tight` (`components/library/library-empty-state.tsx:30`).
- Body and help: `text-sm text-muted-foreground` (700+ uses), small help `text-xs text-muted-foreground`.
- Eyebrow label: `text-xs font-medium text-muted-foreground uppercase tracking-wider` (`app/settings/connections/page.tsx:126`), smaller `text-[11px] … tracking-wider` (`app/settings/ai/page.tsx:359`).
- Mono for ids, keys, addresses: `text-xs font-mono text-muted-foreground` (`app/settings/connections/page.tsx:148`).
- Field: `space-y-1.5` for label, control, help (`app/settings/ai/page.tsx:436`). No `ui/field.tsx` or `ui/form.tsx` exists.
- Section gaps `space-y-4` or `space-y-6`; row lists `space-y-2`; forms cap at `max-w-2xl`.

## Buttons, empty states, progress, feedback

- Primary CTA = default `Button`; on empty states it gets `rounded-xl` (`components/library/library-empty-state.tsx:42`). Secondary = `outline`, quiet = `ghost`, delete = `destructive` or `text-destructive hover:bg-destructive/10` inside menus (`app/extraction/[jobId]/page.tsx:734`).
- Empty state: centred, icon tile `rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm` with `h-7 w-7 text-muted-foreground` icon, `mt-2 max-w-md text-sm leading-6` copy, `mt-6` button row (`components/library/library-empty-state.tsx:24-59`).
- Progress: `components/ui/progress.tsx` (`h-2 rounded-full bg-primary/20`) with a caption row `flex justify-between text-sm mb-2` (`components/extraction/job-progress-bar.tsx:62-80`). No stepper component exists.
- Toasts: sonner, short title plus optional description (`components/ui/sonner.tsx`). Confirmations use `ui/alert-dialog`.
- Tooltip is inverted (`bg-foreground text-background`) (`components/ui/tooltip.tsx:48`).
- Dark mode: `--radius` is smaller in dark (`app/globals.css:97,152`); tokens handle the rest. Do not hard-code white.
