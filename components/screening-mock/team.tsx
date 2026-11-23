"use client";

// Adding a reviewer to a screening: a person from the workspace, someone outside it, an address to
// invite, or any model in the catalogue at any effort. Used by the form and by the open screening.

import { useState, type ReactNode } from "react";
import { Mail, UserPlus } from "@/components/icons";
import { ModelPicker } from "@/components/models/model-picker";
import { usePresetModels, type MapModel } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { stripProviderPrefix } from "@/lib/ai/model-display";
import { PRESET_KEYS } from "@/lib/ai/tasks";
import { PEOPLE, type Person } from "./data";

/** Picks a person: the workspace's members first, then people outside it, or an email address to invite. */
export function AddPerson({ exclude, onPick, children }: { exclude: string[]; onPick: (pick: { person: Person } | { email: string }) => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const left = PEOPLE.filter((person) => !exclude.includes(person.id));
  const email = /^\S+@\S+\.\S+$/.test(text.trim()) ? text.trim() : null;
  const pick = (value: { person: Person } | { email: string }) => {
    onPick(value);
    setOpen(false);
    setText("");
  };
  const group = (heading: string, people: Person[]) =>
    people.length ? (
      <CommandGroup heading={heading}>
        {people.map((person) => (
          <CommandItem key={person.id} value={person.name} onSelect={() => pick({ person })} className="gap-3">
            <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-7" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{person.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{person.seen}</span>
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children ?? <Button variant="outline" size="sm"><UserPlus />Add a person</Button>}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput value={text} onValueChange={setText} placeholder="Find a person, or type an email" />
          <CommandList className="max-h-72">
            <CommandEmpty>{email ? null : "Nobody by that name. Type an email address to invite someone."}</CommandEmpty>
            {group("In this workspace", left.filter((person) => !person.guest))}
            {group("Outside it", left.filter((person) => person.guest))}
            {email ? (
              <CommandGroup heading="Invite">
                <CommandItem value={email} onSelect={() => pick({ email })} className="gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Mail className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{email}</span>
                    <span className="block text-xs text-muted-foreground">Gets an email, and votes once they join</span>
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

/** Picks a model from the whole catalogue, at an effort where it takes one. The four presets' own picks come first. */
export function AddModel({ exclude, onPick, children }: { exclude: string[]; onPick: (model: MapModel) => void; children: ReactNode }) {
  const presetModel = usePresetModels();
  const presets = presetModel
    ? PRESET_KEYS.flatMap((id) => {
        const model = presetModel(id, "screenAll");
        return model && !exclude.includes(model.id) ? [{ id, models: [model], onSelect: () => onPick({ ...model, name: stripProviderPrefix(model.name) }) }] : [];
      })
    : undefined;
  return (
    <ModelPicker current={undefined} efforts tasks={["screenAll"]} exclude={exclude} presets={presets} align="start" trigger={children} onChange={(model, effort) => onPick({ ...model, name: stripProviderPrefix(model.name), ...(effort ? { effort } : {}) })} />
  );
}

/** Asks before a change to a running screening, saying first what it will do. */
export function ConfirmChange({ open, title, confirm, onConfirm, onClose, children }: { open: boolean; title: string; confirm: string; onConfirm: () => void; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">What this change does to the screening</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onConfirm(); onClose(); }}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
