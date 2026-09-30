"use client";

// The Evidence Library settings page beside the assistant, reduced to the parts the
// mock edits, built from the real configuration components.

import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, FolderCheck, Globe, House, Library, Palette, Rocket, Save, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, SectionCard } from "@/components/evidence-libraries/configuration/section-card";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { RailGroup, RailLink } from "@/components/evidence-libraries/configuration/navigation-rail";
import { EASE } from "@/components/settings/model-map";
import { LogoMark } from "./logo-mark";
import { useMock } from "./context";
import { COLLECTION_NAME, LIBRARY } from "./data";

const LIMITS = { name: 100, tagline: 160, description: 300 };

/** The assistant's changes glow for a moment, then settle into ordinary fields. */
const glow = (on: boolean) => cn("bg-background transition-[box-shadow,background-color] duration-[1200ms]", on && "bg-primary/[0.06] ring-2 ring-primary/40");

function ChangedPill({ onUndo }: { onUndo: () => void }) {
  return (
    <motion.span
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-0.5 text-xs font-medium text-primary"
    >
      <LogoMark size={13} /> Changed by the assistant
      <button type="button" onClick={onUndo} className="ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-primary/15">
        <Undo2 className="size-3" /> Undo
      </button>
    </motion.span>
  );
}

export function LibraryPane() {
  const { library, undoLibrary } = useMock();
  const status =
    library.status === "live" ? (
      <StatusChip tone="success" icon="tone">Live</StatusChip>
    ) : library.status === "publishing" ? (
      <StatusChip tone="running" icon="tone">Publishing</StatusChip>
    ) : (
      <StatusChip tone="neutral">{library.changed ? "Unpublished changes" : "Draft"}</StatusChip>
    );
  const collections = [...LIBRARY.collections, ...library.collections];
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 flex h-12 items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-lg text-muted-foreground">
          <ChevronLeft className="size-4" />
        </span>
        <span className="size-7 rounded-lg bg-[#2dd4bf]" aria-hidden />
        <p className="text-base font-semibold">{LIBRARY.name}</p>
        {status}
        <span className="hidden truncate text-sm text-muted-foreground lg:block">{LIBRARY.address}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <Save className="size-3.5" /> Saved
          </Button>
          <Button size="sm" className="gap-1.5" disabled={library.status !== "draft" || !library.changed}>
            <Rocket className="size-3.5" /> Publish changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[12rem_1fr] gap-6">
        <nav className="space-y-5 pt-1" aria-label="Library settings">
          <RailGroup label="Brand">
            <RailLink href="#identity" icon={Globe} active onClick={() => undefined}>Identity</RailLink>
            <RailLink href="#theme" icon={Palette} active={false} onClick={() => undefined}>Theme</RailLink>
          </RailGroup>
          <RailGroup label="Content">
            <RailLink href="#home" icon={House} active={false} onClick={() => undefined}>Home page</RailLink>
            <RailLink href="#collections" icon={Library} active={false} onClick={() => undefined}>Collections</RailLink>
          </RailGroup>
        </nav>

        <div className="space-y-5">
          <SectionCard
            id="identity"
            icon={Globe}
            title="Identity"
            description="The name people see, the address they visit, and how the library looks when shared."
            aside={library.changed && library.status === "draft" ? <ChangedPill onUndo={undoLibrary} /> : null}
          >
            <Field label="Name" counter={`${LIBRARY.name.length} / ${LIMITS.name}`}>
              {(id) => <Input id={id} className="bg-background" value={LIBRARY.name} readOnly />}
            </Field>
            <Field label="Tagline" counter={`${library.tagline.length} / ${LIMITS.tagline}`} hint="The heading above the library search. Leave empty to show Search.">
              {(id) => (
                <Input id={id} className={glow(library.highlight && Boolean(library.tagline))} value={library.tagline} placeholder="Evidence for better decisions" readOnly />
              )}
            </Field>
            <Field label="Description" counter={`${library.description.length} / ${LIMITS.description}`} hint="Shown on the home page and in search results.">
              {(id) => (
                <Textarea id={id} rows={3} className={cn("resize-none", glow(library.highlight && Boolean(library.description)))} value={library.description} readOnly />
              )}
            </Field>
          </SectionCard>

          <SectionCard id="collections" icon={Library} title="Featured collections" description="Shown on the home page, in this order.">
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {collections.map((name) => {
                  const fresh = name === COLLECTION_NAME;
                  return (
                    <motion.li
                      key={name}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm",
                        glow(fresh && library.highlight),
                      )}
                    >
                      <FolderCheck className={cn("size-4", fresh ? "text-[#2dd4bf]" : "text-muted-foreground")} />
                      <span className="flex-1 font-medium">{name}</span>
                      {fresh ? <span className="text-xs text-muted-foreground">4 papers</span> : null}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
