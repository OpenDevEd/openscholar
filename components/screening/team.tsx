"use client";

// Adding a reviewer to a screening: a member of the workspace, an address to invite from outside it,
// or any model in the catalogue at any effort. Used by the form and by the open screening.

import { useState, type ReactNode } from "react";
import { Mail, UserPlus } from "@/components/icons";
import { ModelPicker } from "@/components/models/model-picker";
import { usePresetModels, type MapModel } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutoHeight } from "@/components/ui/auto-height";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { stripProviderPrefix } from "@/lib/ai/model-display";
import { PRESET_KEYS } from "@/lib/ai/tasks";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { modelKey, type Person } from "./data";
import { paperCredits, pdfsMissed } from "./store";
import { useWords } from "./words";
import type { Pdfs } from "@/lib/pricing/estimate";

/** Picks a person: a member of the workspace the page is in, found by name or email, or an email address to invite from outside it. */
export function AddPerson({ exclude, onPick, children }: { exclude: string[]; onPick: (pick: { person: Person } | { email: string }) => void; children?: ReactNode }) {
  const t = useTranslations("screening.list");
  const words = useWords();
  const [open, setOpen] = useState(false);
  // The pointer over the button or the keyboard on it: the members are read from then, so the picker opens with them in it.
  const [near, setNear] = useState(false);
  const [text, setText] = useState("");
  const workspaceId = useWorkspace();
  // The workspace's members whose name or email holds what was typed.
  const read = useProtectedQuery(api.screening.reviewers.candidates, inWorkspace(workspaceId, open || near ? { text: text.trim(), exclude, paginationOpts: { cursor: null, numItems: 20 } } : "skip")).data;
  // While the next letter's people are read, the last ones found stay, dimmed: the list never empties into placeholders under the typing.
  const [last, setLast] = useState(read);
  if (read !== undefined && read !== last) setLast(read);
  const found = read ?? last;
  const stale = read === undefined && last !== undefined;
  // Rows found for what was typed before stay to look at, never to pick: Enter waits for the people the typing finds.
  const left = (found?.page ?? []).filter((person) => !exclude.includes(person.id));
  const email = /^\S+@\S+\.\S+$/.test(text.trim()) ? text.trim().toLowerCase() : null;
  // Someone typed as an address who is a member is added as that member, never invited.
  const member = email ? left.find((person) => person.email.toLowerCase() === email) : undefined;
  const pick = (value: { person: Person } | { email: string }) => {
    onPick(value);
    setOpen(false);
    setText("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onPointerEnter={() => setNear(true)} onFocus={() => setNear(true)}>{children ?? <Button variant="outline" size="sm"><UserPlus />{t("addPerson")}</Button>}</PopoverTrigger>
      <PopoverContent align="start" aria-label={t("addPerson")} className={`w-80 p-0 ${AVATARS_FADE_IN}`}>
        <p className="px-3 pt-3 text-sm font-semibold">{t("addPerson")}</p>
        {/* The server finds the people: the list isn't narrowed again here. */}
        <Command shouldFilter={false}>
          <CommandInput value={text} onValueChange={setText} placeholder={t("findPerson")} />
          <CommandList className="max-h-72">
            {/* Opened before the members are in, it keeps rows for them, and slides to the list that comes. */}
            <AutoHeight>
            {found === undefined ? (
              <div aria-hidden className="space-y-1 p-1">
                {[0, 1, 2].map((at) => (
                  <div key={at} className="flex items-center gap-3 px-2 py-1.5">
                    <SkeletonBar className="size-7 shrink-0 rounded-full" />
                    <span className="min-w-0 flex-1 space-y-1.5"><SkeletonBar className="w-1/2" /><SkeletonBar className="h-2.5 w-2/3" /></span>
                  </div>
                ))}
              </div>
            ) : null}
            <CommandEmpty>{email || found === undefined ? null : text.trim() ? t("nobodyByName") : t("nobodyElse")}</CommandEmpty>
            {left.length ? (
              <CommandGroup heading={words.t("person.member")} className={cn("transition-opacity", stale && "opacity-60")}>
                {left.map((person) => (
                  <CommandItem key={person.id} value={person.id} disabled={stale} onSelect={() => pick({ person: { id: person.id, name: person.name, ...(person.imageUrl ? { imageUrl: person.imageUrl } : {}) } })} className="gap-3">
                    <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-7" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{person.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {email && !member ? (
              <CommandGroup heading={t("invite")}>
                <CommandItem value={email} disabled={stale} onSelect={() => pick({ email })} className="gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Mail className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{email}</span>
                    <span className="block text-xs text-muted-foreground">{words.t("person.invites")}</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            </AutoHeight>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Picks a model from the whole catalogue, at an effort where it takes one. The presets' own picks come first, each
 * model once: presets that pick the same model are one choice here. A model at one effort is one reviewer, as the
 * server has it (convex/screening/reviewers.ts): the same model at another effort can be added beside it, and the
 * same one at the same effort can't be added twice.
 */
export function AddModel({ taken, pdfs, onPick, children }: { /** The models on it already, each as its model and effort (./data.ts `modelKey`). */ taken: string[]; /** Its papers that are only a PDF: a pick that can't read them says so before it is made. */ pdfs: Pdfs; onPick: (model: MapModel) => void; children: ReactNode }) {
  const t = useTranslations("screening.list");
  const tf = useTranslations("screening.form");
  const words = useWords();
  // What a pick can't read, in the words its reviewer row uses once it is picked.
  const missed = (model: MapModel) => { const left = pdfsMissed(model, pdfs); return left.papers ? tf("reviewers.pdfsMissed", { why: left.why, count: left.papers }) : undefined; };
  const presetModel = usePresetModels();
  const pick = (model: MapModel) => (taken.includes(modelKey(model)) ? void toast(t("onAlready", { name: stripProviderPrefix(model.name), effort: String(Boolean(model.effort)) })) : onPick({ ...model, name: stripProviderPrefix(model.name) }));
  const picks = presetModel ? PRESET_KEYS.flatMap((id) => { const model = presetModel(id, "screenAll"); return model && !taken.includes(modelKey(model)) ? [{ id, model }] : []; }) : undefined;
  const presets = picks?.filter((one, at) => picks.findIndex((other) => modelKey(other.model) === modelKey(one.model)) === at).map(({ id, model }) => ({ id, models: [model], onSelect: () => pick(model), ...(missed(model) ? { note: missed(model) } : {}) }));
  return (
    <ModelPicker current={undefined} efforts tasks={["screenAll"]} presets={presets} price={{ heading: t("pickerCost"), of: (model) => words.credits(paperCredits(model)) }} align="start" trigger={children} onChange={(model, effort) => pick({ ...model, ...(effort ? { effort } : {}) })} />
  );
}

/** Asks before a change to a running screening, saying first what it will do. A change that can't be taken back, such as a deletion, is `destructive`: its button is red. */
export function ConfirmChange({ open, title, confirm, cancel, disabled = false, variant = "default", onConfirm, onClose, children }: { open: boolean; title: string; confirm: string; /** What the way out says, where "Cancel" would be unclear: "Keep editing". */ cancel?: string; /** The change can't be made as it stands: what is shown says why. */ disabled?: boolean; variant?: "default" | "destructive"; onConfirm: () => void; onClose: () => void; children?: ReactNode }) {
  const t = useTranslations("screening.list");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent role={variant === "destructive" ? "alertdialog" : "dialog"} className={`max-w-md ${AVATARS_FADE_IN}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{t("confirm.what")}</DialogDescription>
        </DialogHeader>
        {children ? <div className="space-y-3">{children}</div> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{cancel ?? t("confirm.cancel")}</Button>
          <Button variant={variant} disabled={disabled} onClick={() => { onConfirm(); onClose(); }}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
