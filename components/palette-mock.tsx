"use client";

// MOCK ONLY. A corner switcher for comparing colour directions in the running
// app. Delete this file and app/palette-mock.css once a direction is chosen.
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, PaletteIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import "@/app/palette-mock.css";

const PALETTES = {
  light: [
    { id: "", label: "Neutral (current)" },
    { id: "wash", label: "Blue wash" },
    { id: "tinted", label: "Tinted cards" },
    { id: "rail", label: "Navy sidebar" },
  ],
  dark: [
    { id: "", label: "White on black (current)" },
    { id: "blue", label: "Blue on black" },
    { id: "navy", label: "Navy cards" },
    { id: "raised", label: "Raised cards" },
  ],
} as const;

type Mode = keyof typeof PALETTES;
const storageKey = (mode: Mode) => `palette-mock-${mode}`;
const attribute = (mode: Mode) => `data-palette-${mode}`;

export function PaletteMock() {
  const { resolvedTheme } = useTheme();
  const [chosen, setChosen] = useState<Record<Mode, string>>({ light: "", dark: "" });

  // Outside system: <html> attributes and localStorage. Restores the stored choice after load.
  useEffect(() => {
    const stored = { light: localStorage.getItem(storageKey("light")) ?? "", dark: localStorage.getItem(storageKey("dark")) ?? "" };
    for (const mode of ["light", "dark"] as const) document.documentElement.setAttribute(attribute(mode), stored[mode]);
    setChosen(stored);
  }, []);

  if (!resolvedTheme) return null;
  const mode: Mode = resolvedTheme === "dark" ? "dark" : "light";

  const choose = (id: string) => {
    document.documentElement.setAttribute(attribute(mode), id);
    localStorage.setItem(storageKey(mode), id);
    setChosen((current) => ({ ...current, [mode]: id }));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="fixed bottom-4 right-4 z-50 shadow-lg">
          <PaletteIcon className="size-4" />
          Colours (mock)
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72 p-2">
        <div role="radiogroup" aria-label="Colour direction" className="grid grid-cols-2 gap-2">
          {PALETTES[mode].map(({ id, label }) => {
            const selected = chosen[mode] === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(id)}
                className={cn(
                  "overflow-hidden rounded-lg border text-left text-xs font-medium outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/40",
                )}
              >
                {/* A small page in that direction's colours: sidebar, page, a card and the brand colour. */}
                <span data-palette-preview={id || undefined} className="flex h-16 bg-background">
                  <span className="palette-rail w-4 border-r border-sidebar-border bg-sidebar" />
                  <span className="flex flex-1 items-center justify-center p-2">
                    <span className="flex h-full w-full items-end rounded-md border bg-card p-1.5">
                      <span className="h-1.5 w-8 rounded-full bg-primary" />
                    </span>
                  </span>
                </span>
                <span className="flex items-center justify-between gap-1 px-2 py-1.5">
                  {label}
                  {selected && <Check className="size-3.5 shrink-0" />}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
