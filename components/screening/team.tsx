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
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { stripProviderPrefix } from "@/lib/ai/model-display";
import { PRESET_KEYS } from "@/lib/ai/tasks";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { PERSON_SAYS, type Person } from "./data";

/** Picks a person: a member of the workspace the page is in, found by name or email, or an email address to invite from outside it. */
export function AddPerson({ exclude, onPick, children }: { exclude: string[]; onPick: (pick: { person: Person } | { email: string }) => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const workspaceId = useWorkspace();
  // Read once the picker is open: the workspace's members whose name or email holds what was typed.
  const found = useProtectedQuery(api.screening.reviewers.candidates, inWorkspace(workspaceId, open ? { text: text.trim(), paginationOpts: { cursor: null, numItems: 20 } } : "skip")).data;
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
      <PopoverTrigger asChild>{children ?? <Button variant="outline" size="sm"><UserPlus />Add a person</Button>}</PopoverTrigger>
      <PopoverContent align="start" aria-label="Add a person" className={`w-80 p-0 ${AVATARS_FADE_IN}`}>
        <p className="px-3 pt-3 text-sm font-semibold">Add a person</p>
        {/* The server finds the people: the list isn't narrowed again here. */}
        <Command shouldFilter={false}>
          <CommandInput value={text} onValueChange={setText} placeholder="Find a person, or type an email" />
          <CommandList className="max-h-72">
            <CommandEmpty>{email || found === undefined ? null : "Nobody in this workspace by that name. Type an email address to invite someone."}</CommandEmpty>
            {left.length ? (
              <CommandGroup heading={PERSON_SAYS.member}>
                {left.map((person) => (
                  <CommandItem key={person.id} value={person.id} onSelect={() => pick({ person: { id: person.id, name: person.name, ...(person.imageUrl ? { imageUrl: person.imageUrl } : {}) } })} className="gap-3">
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
              <CommandGroup heading="Invite">
                <CommandItem value={email} onSelect={() => pick({ email })} className="gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Mail className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{email}</span>
                    <span className="block text-xs text-muted-foreground">{PERSON_SAYS.invites}</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Picks a model from the whole catalogue, at an effort where it takes one. The presets' own picks come first, each model once: presets that pick the same model are one choice here. */
export function AddModel({ exclude, onPick, children }: { exclude: string[]; onPick: (model: MapModel) => void; children: ReactNode }) {
  const presetModel = usePresetModels();
  const picks = presetModel ? PRESET_KEYS.flatMap((id) => { const model = presetModel(id, "screenAll"); return model && !exclude.includes(model.id) ? [{ id, model }] : []; }) : undefined;
  const presets = picks?.filter((pick, at) => picks.findIndex((one) => one.model.id === pick.model.id && one.model.effort === pick.model.effort) === at).map(({ id, model }) => ({ id, models: [model], onSelect: () => onPick({ ...model, name: stripProviderPrefix(model.name) }) }));
  return (
    <ModelPicker current={undefined} efforts tasks={["screenAll"]} exclude={exclude} presets={presets} align="start" trigger={children} onChange={(model, effort) => onPick({ ...model, name: stripProviderPrefix(model.name), ...(effort ? { effort } : {}) })} />
  );
}

/** Asks before a change to a running screening, saying first what it will do. A change that can't be taken back, such as a deletion, is `destructive`: its button is red. */
export function ConfirmChange({ open, title, confirm, cancel = "Cancel", disabled = false, variant = "default", onConfirm, onClose, children }: { open: boolean; title: string; confirm: string; /** What the way out says, where "Cancel" would be unclear: "Keep editing". */ cancel?: string; /** The change can't be made as it stands: what is shown says why. */ disabled?: boolean; variant?: "default" | "destructive"; onConfirm: () => void; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent role={variant === "destructive" ? "alertdialog" : "dialog"} className={`max-w-md ${AVATARS_FADE_IN}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">What this change does to the screening</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{cancel}</Button>
          <Button variant={variant} disabled={disabled} onClick={() => { onConfirm(); onClose(); }}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
