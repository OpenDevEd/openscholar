"use client";

// Not part of the product: a switch for whoever reviews the mock, to see it as another person, with
// no credits, or as a workspace that has never screened anything. Every state the design has to
// answer for is one click away, where data would otherwise decide it.

import { Check, FlaskConical, RotateCcw } from "@/components/icons";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PEOPLE } from "./data";
import { KEPT, credits, seeded, useMock } from "./store";

const AS = [
  { id: "amina", what: "Started most of them" },
  { id: "jonas", what: "A reviewer" },
  { id: "kwame", what: "In the workspace, on few screenings" },
  { id: "rahul", what: "From outside: votes on one, views another" },
];

export function MockStates() {
  const store = useMock();
  const option = (on: boolean, label: string, detail: string, pick: () => void) => (
    <button type="button" role="radio" aria-checked={on} onClick={pick} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-muted", on && "bg-muted")}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {on ? <Check className="size-4 shrink-0 text-primary" /> : null}
    </button>
  );
  return (
    <Popover>
      {/* Bottom left, clear of the assistant's button: wherever there is a sidebar, in its empty foot above the account. */}
      <TooltipHint label="Mock states">
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Mock states" className="fixed bottom-3 start-3 z-50 size-8 rounded-full border-dashed bg-card sm:bottom-[4.75rem] sm:start-6">
            <FlaskConical />
          </Button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent side="top" align="start" className={`w-80 space-y-3 p-3 ${AVATARS_FADE_IN}`}>
        <p className="px-1 text-xs text-muted-foreground">Only in this mock: switch what real data would decide.</p>
        <div role="radiogroup" aria-label="See it as" className="space-y-0.5">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">See it as</p>
          {AS.map(({ id, what }) => {
            const person = PEOPLE.find((one) => one.id === id)!;
            const on = store.viewer === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={on} onClick={() => store.set({ viewer: id })} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-muted", on && "bg-muted")}>
                <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-7 self-start" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{what}</span>
                </span>
                {on ? <Check className="size-4 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
        <div role="radiogroup" aria-label="Credits" className="space-y-0.5">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Credits</p>
          {option(store.wallet > 50, "Plenty", `${credits(Math.max(store.wallet, 18_420))} credits`, () => store.set({ wallet: Math.max(store.wallet, 18_420) }))}
          {option(store.wallet <= 50, "Run out", "Models stop where they are", () => store.set({ wallet: 0 }))}
        </div>
        <div role="radiogroup" aria-label="Workspace" className="space-y-0.5">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Workspace</p>
          {option(!store.firstTime, "Has screenings", "Eight, in every state", () => store.set({ firstTime: false, screenings: seeded(), drafts: {} }))}
          {option(store.firstTime, "First time", "Starts with nothing screened", () => store.set({ firstTime: true, screenings: [], drafts: {} }))}
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => { window.sessionStorage.removeItem(KEPT); window.location.reload(); }}><RotateCcw />Start the mock again</Button>
      </PopoverContent>
    </Popover>
  );
}
