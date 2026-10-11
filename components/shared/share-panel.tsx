"use client";

// Sharing anything, the same way everywhere: a chat in the assistant's stack of cards, an item
// in a dialog. One field finds people by name or invites an email, one list says who has it and
// what each can do, and the foot copies the link. Whoever holds the data fills it in.

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Check, Link2, UserPlus, X } from "@/components/icons";
import { IconButton } from "@/components/assistant/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { EmailAvatar, IdentityRow, ROLE_ICONS, RoleLabel, type RoleKind } from "@/components/ui/identity";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A role someone can be given here: `label` in the picker, `can` where it's only read. */
export type ShareRole<R extends string> = { id: R; kind: RoleKind; label: string; can: string };

export type ShareEntry<R extends string> = {
  key: string;
  avatar: ReactNode;
  name: string;
  you?: boolean;
  detail?: ReactNode;
  /** One of the roles given here, or one that comes from elsewhere, such as the owner's. */
  role: R | { kind: RoleKind; label: string };
  /** Whoever shares can change it. */
  onRole?: (role: R) => void;
  onRemove?: () => void;
};

type ShareCandidate = { key: string; avatar: ReactNode; name: string; detail?: string; pick: () => void };

/** The field, for whoever can share: people found by what's typed, and the typed email to invite. */
export type ShareAdding = {
  query: string;
  onQuery: (query: string) => void;
  /** Undefined while the first of them loads. */
  candidates: ShareCandidate[] | undefined;
  /** More people to look through, a page at a time. */
  more?: { loading: boolean; load: () => void };
  invite: (email: string) => void;
  /** Whether an email already has it, so it isn't offered again. */
  has: (email: string) => boolean;
  /** Why nobody more can be added, such as a plan's guest limit. */
  full?: string;
};

export function SharePanel<R extends string>({ adding, roles, entries, foot, onCopy }: { adding?: ShareAdding; roles: Array<ShareRole<R>>; entries: Array<ShareEntry<R>>; foot?: ReactNode; onCopy: () => Promise<void> }) {
  const t = useTranslations("workspaces.share");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLLabelElement>(null);
  const suggestions = useRef<HTMLUListElement>(null);
  const typed = adding?.query.trim().toLowerCase() ?? "";
  const canInvite = adding !== undefined && !adding.full && EMAIL.test(typed) && !adding.has(typed);
  const candidates = adding?.candidates ?? [];
  const choices = (canInvite ? 1 : 0) + candidates.length;
  const options = roles.map((role) => ({ id: role.id, label: role.label, icon: ROLE_ICONS[role.kind] }));
  const reset = () => {
    adding?.onQuery("");
    setActive(0);
  };
  // Picking someone closes the list; typing or clicking the field opens it again.
  const choose = (at: number) => {
    if (canInvite && at === 0) adding.invite(typed);
    else candidates[at - (canInvite ? 1 : 0)]?.pick();
    reset();
    setOpen(false);
  };

  return (
    <>
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-4 px-3 py-3">
          {adding ? (
            // The suggestions open over everything below, at the box's width, so nothing under them moves and
            // no edge of a short dialog cuts them. They open when the box is clicked or typed in, not when a dialog
            // puts focus there as it opens, and stay open while focus is in the box or in them, so Tab reaches them too.
            <div
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget) && !suggestions.current?.contains(e.relatedTarget)) setOpen(false);
              }}
            >
              <Popover open={open && adding.candidates !== undefined && !adding.full} onOpenChange={setOpen} modal={false}>
                <PopoverAnchor asChild>
                  <label ref={field} className={cn("flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40", adding.full && "opacity-60")}>
                    <UserPlus className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      value={adding.query}
                      disabled={adding.full !== undefined}
                      onChange={(e) => {
                        adding.onQuery(e.target.value);
                        setActive(0);
                        setOpen(true);
                      }}
                      onClick={() => setOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") setOpen(true);
                        if (!choices) return;
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          setActive((i) => (i + (e.key === "ArrowDown" ? 1 : choices - 1)) % choices);
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          choose(Math.min(active, choices - 1));
                        }
                      }}
                      role="combobox"
                      aria-expanded={open && adding.candidates !== undefined}
                      aria-controls="share-suggestions"
                      placeholder={adding.full ?? t("addPeople")}
                      aria-label={t("addPeople")}
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                    />
                  </label>
                </PopoverAnchor>
                <PopoverContent
                  align="start"
                  // Focus stays in the box, which steps through the list with the arrow keys.
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onInteractOutside={(e) => {
                    if (field.current?.contains(e.target as Node)) e.preventDefault();
                  }}
                  className="w-(--radix-popover-trigger-width) rounded-2xl border-border/60 p-1.5 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.45)]"
                >
                  <ul ref={suggestions} id="share-suggestions" role="listbox">
                    {canInvite ? (
                      <Suggestion active={active === 0} onHover={() => setActive(0)} onPick={() => choose(0)} avatar={<EmailAvatar />} name={t("inviteEmail", { email: typed })} detail={t("byEmail")} />
                    ) : null}
                    {candidates.map((candidate, at) => {
                      const i = at + (canInvite ? 1 : 0);
                      return <Suggestion key={candidate.key} active={i === active} onHover={() => setActive(i)} onPick={() => choose(i)} avatar={candidate.avatar} name={candidate.name} detail={candidate.detail} />;
                    })}
                    {choices === 0 && !adding.more ? <li className="px-2.5 py-2 text-sm text-muted-foreground">{t("noCandidates")}</li> : null}
                    {/* A page looks through only so many people, so more may follow even after an empty one. */}
                    {adding.more ? (
                      <li>
                        <button
                          type="button"
                          disabled={adding.more.loading}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={adding.more.load}
                          className="flex h-8 w-full items-center rounded-xl px-2.5 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {t("morePeople")}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {entries.map((entry) => {
                const given = typeof entry.role === "string" ? roles.find((role) => role.id === entry.role) : undefined;
                const fixed = typeof entry.role === "string" ? (given ? { kind: given.kind, label: given.can } : null) : entry.role;
                return (
                  <motion.li key={entry.key} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                    <IdentityRow className="rounded-xl px-2 py-2" avatar={entry.avatar} name={entry.name} you={entry.you} detail={entry.detail}>
                      {entry.onRole && typeof entry.role === "string" ? (
                        <Segmented label={t("accessOf", { name: entry.name })} value={entry.role} onChange={entry.onRole} options={options} />
                      ) : fixed ? (
                        <RoleLabel role={fixed.kind} className="px-2">
                          {fixed.label}
                        </RoleLabel>
                      ) : null}
                      {entry.onRemove ? <IconButton small label={t("remove")} icon={<X className="size-3.5" />} onClick={entry.onRemove} /> : null}
                    </IdentityRow>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      </ScrollArea>
      {/* What sharing gives, in the foot: the list over it can grow as it loads without moving it. */}
      <div className="space-y-3 border-t border-border/50 p-3">
        {foot}
        <button type="button" onClick={() => onCopy().then(() => setCopied(true), () => {})} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-muted/60 text-sm font-medium hover:bg-muted">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={copied ? "copied" : "copy"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE }} className="flex items-center gap-2">
              {copied ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />}
              {copied ? t("linkCopied") : t("copyLink")}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </>
  );
}

/** One person the field offers; picking keeps focus in the field, ready to add the next. */
function Suggestion({ active, onHover, onPick, avatar, name, detail }: { active: boolean; onHover: () => void; onPick: () => void; avatar: ReactNode; name: string; detail?: string }) {
  return (
    <li role="option" aria-selected={active}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onMouseEnter={onHover} onClick={onPick} className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left", active && "bg-muted")}>
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
        </span>
      </button>
    </li>
  );
}
