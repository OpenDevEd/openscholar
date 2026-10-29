"use client";

// Mock (mock/ai-overview): making or changing a lens. Its state is inside DialogContent, so each
// opening starts from the lens it opened on.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Users } from "@/components/icons";
import { useLenses, type Lens } from "./lenses";

export function LensDialog({ lens, open, onOpenChange }: { lens: Lens | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <LensForm key={lens?.id ?? "new"} lens={lens} done={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LensForm({ lens, done }: { lens: Lens | null; done: () => void }) {
  const save = useLenses((s) => s.save);
  const [name, setName] = useState(lens?.name ?? "");
  const [instruction, setInstruction] = useState(lens?.instruction ?? "");
  const [shared, setShared] = useState(lens?.shared ?? false);
  const ready = name.trim() && instruction.trim();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        save({ id: lens?.id, name: name.trim(), instruction: instruction.trim(), shared });
        done();
      }}
    >
      <DialogHeader>
        <DialogTitle>{lens ? "Edit lens" : "New lens"}</DialogTitle>
        <DialogDescription>An overview of every search, written for what you want to know.</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1.5 text-sm font-medium">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Year by year" maxLength={40} autoFocus />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        What to look at
        <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="How output changes from year to year, and which years stand out" className="min-h-24 font-normal" maxLength={600} />
      </label>
      <label className="flex items-center gap-3 rounded-xl bg-inset px-3 py-2.5 text-sm">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Share with this workspace</span>
        <Switch checked={shared} onCheckedChange={setShared} />
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          {lens ? "Save" : "Add lens"}
        </Button>
      </DialogFooter>
    </form>
  );
}
