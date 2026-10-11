"use client";

// The mock's own controls, for states a real organization can't be put in on demand: a failed
// payment and seats held by members who were removed after spending credits.

import { useState } from "react";
import { ChevronDown, Minus, Plus, RotateCcw } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import type { SeatsMock } from "./store";

export function SeatsMockPanel({ mock, set, reset }: { mock: SeatsMock | undefined; set: (patch: Partial<SeatsMock>) => void; reset: () => void }) {
  const [open, setOpen] = useState(true);
  if (!mock) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 w-60 space-y-2.5 rounded-2xl border border-border-subtle bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 font-semibold">
          <ChevronDown className={open ? "size-3.5" : "size-3.5 -rotate-90"} /> Seats mock
        </button>
        <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <RotateCcw className="size-3" /> Reset
        </button>
      </div>
      {open ? (
        <>
      <label className="flex items-center justify-between gap-2">
        On Team
        <Switch size="sm" checked={mock.team} onCheckedChange={(team) => set({ team, toFree: false })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        Last payment failed
        <Switch size="sm" checked={mock.failed} onCheckedChange={(failed) => set({ failed })} />
      </label>
      <div className="flex items-center justify-between gap-2">
        Held seats
        <span className="flex items-center rounded-full bg-inset p-0.5">
          <button type="button" aria-label="One held seat fewer" disabled={mock.held === 0} onClick={() => set({ held: mock.held - 1, seats: mock.seats - 1 })} className="flex size-5 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40">
            <Minus className="size-3" />
          </button>
          <span className="w-5 text-center tabular-nums">{mock.held}</span>
          <button type="button" aria-label="One held seat more" onClick={() => set({ held: mock.held + 1, seats: mock.seats + 1 })} className="flex size-5 items-center justify-center rounded-full hover:bg-muted">
            <Plus className="size-3" />
          </button>
        </span>
      </div>
        </>
      ) : null}
    </div>
  );
}
