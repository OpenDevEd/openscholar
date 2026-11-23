"use client";

// Identifier services (plans/identifier-services): how each registrar is used for a publisher's records, what it
// adds to the price, what authors pick, and which identifier the byline prints. Reports show prices; communities,
// which don't charge per record, don't.
// MOCK (mock/identifier-services): kept in this browser (identifiers-mock-store.ts), with English words.

import { AnimatePresence, motion } from "motion/react";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, FileText, TriangleAlert } from "@/components/icons";
import { EASE } from "@/components/ui/opening";
import { SERVICES, SERVICE_IDS, optionalOf, printable, settingsProblem, type Identifiers, type ServiceId, type ServiceMode } from "@/lib/reports/identifiers";
import { setMockIdentifiers, useMockIdentifiers } from "@/lib/reports/identifiers-mock-store";
import { cn } from "@/lib/utils";

const modesFor = (who: string): Array<{ id: ServiceMode; label: string }> => [
  { id: "required", label: "Always" },
  { id: "optional", label: `${who} picks` },
  { id: "off", label: "Off" },
];

const PROBLEM: Record<NonNullable<ReturnType<typeof settingsProblem>>, string> = {
  noService: "Turn on at least one service, or reports get no identifier.",
  rule: "The rule asks for more picks than there are services to pick.",
  nothingPrinted: "Some picks leave the byline nothing to print. Put Crossref first, or mint DOCiDs at signing.",
};

/** A service's mark, at the height its row's text needs. */
export function ServiceMark({ id, className }: { id: ServiceId; className?: string }) {
  return <img src={SERVICES[id].logo} alt={SERVICES[id].name} className={cn("h-5 w-auto shrink-0", id === "crossref" && "rounded bg-white p-px", className)} />;
}

export function IdentifierSettings({ community = false, connected }: { /** A community's records: no prices, editors pick, and nothing is signed, so every identifier can be cited. */ community?: boolean; /** The services whose accounts are set above. */ connected: Record<ServiceId, boolean> }) {
  const prices = !community;
  const who = community ? "Editor" : "Author";
  const ids = useMockIdentifiers();
  const set = (next: Identifiers) => setMockIdentifiers(next);
  const service = (id: ServiceId, patch: Partial<Identifiers["services"][ServiceId]>) => set({ ...ids, services: { ...ids.services, [id]: { ...ids.services[id], ...patch } } });
  const optional = optionalOf(ids);
  // A community's records may have no identifier, and are cited by whatever they have: only the pick rule can be wrong.
  const problem = community ? (settingsProblem(ids) === "rule" ? "rule" : null) : settingsProblem(ids);
  const rules = [
    { id: "any", label: "Any of them", min: 0, max: optional.length },
    { id: "one", label: "At least one", min: 1, max: optional.length },
    ...(optional.length > 1 ? [{ id: "exactly", label: "Exactly one", min: 1, max: 1 }] : []),
  ];
  const rule = rules.find((r) => r.min === ids.choose.min && Math.min(ids.choose.max, optional.length) === r.max)?.id ?? "any";
  const order = ids.citeFirst;
  const move = (id: ServiceId, by: -1 | 1) => {
    const at = order.indexOf(id);
    const next = [...order];
    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
    set({ ...ids, citeFirst: next });
  };
  const on = SERVICE_IDS.filter((id) => connected[id] && ids.services[id].mode !== "off");

  return (
    <Zone
      label="Identifiers"
      aside={
        <span className="flex flex-wrap items-center justify-end gap-2">
          {on.map((id) => (
            <StatusChip key={id} tone={ids.services[id].mode === "required" ? "success" : "neutral"}>
              {SERVICES[id].name}
            </StatusChip>
          ))}
        </span>
      }
    >
      <ul className={LIST}>
        {SERVICE_IDS.map((id) => {
          const s = ids.services[id];
          const ready = connected[id];
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
              <span className="flex min-w-0 flex-1 basis-52 items-start gap-3">
                <span className="min-w-0">
                  <span className="flex h-6 items-center gap-2">
                    <ServiceMark id={id} />
                    <span className="rounded bg-inset px-1.5 text-2xs text-muted-foreground">{SERVICES[id].identifier}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {!ready ? "Turn it on above to use it." : id === "zenodo" ? "Keeps the copy a Crossref DOI leads to, so it goes with every Crossref DOI." : id === "docid" ? "The Africa PID Alliance's identifier. Every one is a permanent Handle." : "The DOI printed on the report."}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <Segmented label={`${SERVICES[id].name}: when`} value={ready ? s.mode : "off"} onChange={(mode) => ready && service(id, { mode })} options={modesFor(who)} />
                {prices ? (
                  <span className={cn("flex items-center gap-1 transition-opacity", (s.mode === "off" || !ready) && "pointer-events-none opacity-40")}>
                    <span className="text-sm text-muted-foreground">+$</span>
                    <Input
                      aria-label={`${SERVICES[id].name}: added to the price`}
                      inputMode="numeric"
                      value={String(s.price)}
                      onChange={(e) => {
                        const dollars = Number(e.target.value.replace(/\D/g, "") || 0);
                        service(id, { price: Math.min(dollars, 10_000) });
                      }}
                      className="h-8 w-16 text-end tabular-nums"
                    />
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        <AnimatePresence initial={false}>
          {optional.length ? (
            <motion.li key="pick" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{who}s pick</span>
                  <span className="block text-xs text-muted-foreground">From {optional.map((id) => SERVICES[id].name).join(" and ")}, {community ? "when they publish a record" : "when they sign"}.</span>
                </span>
                <Segmented label={`${who}s pick`} value={rule} onChange={(id) => { const r = rules.find((x) => x.id === id)!; set({ ...ids, choose: { min: r.min, max: r.max } }); }} options={rules.map(({ id, label }) => ({ id, label }))} />
              </div>
            </motion.li>
          ) : null}
        </AnimatePresence>
        <li className="space-y-2.5 px-4 py-3.5">
          <span className="block min-w-0">
            <span className="block text-sm font-medium">{community ? "Cited first" : "Printed in the byline"}</span>
            <span className="block text-xs text-muted-foreground">{community ? "The first of these a record has leads its citation." : "The first of these a report has. It has to exist when the author signs."}</span>
          </span>
          <ol className="space-y-1.5">
            {order.map((id, at) => (
              <motion.li key={id} layout="position" transition={{ duration: 0.3, ease: EASE }} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-inset px-3 py-2">
                <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">{at + 1}</span>
                <span className="flex min-w-0 flex-1 items-center">
                  <ServiceMark id={id} />
                </span>
                {id === "docid" && !community ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Mint at signing
                    <Switch checked={ids.docidAtSigning} onCheckedChange={(docidAtSigning) => set({ ...ids, docidAtSigning })} aria-label="Mint DOCiDs at signing" />
                  </label>
                ) : null}
                {community || printable(ids, id) ? null : <span className="text-xs text-muted-foreground">Not printable</span>}
                <span className="flex">
                  <Button variant="ghost" size="icon-xs" aria-label={`Move ${SERVICES[id].name} up`} disabled={at === 0} onClick={() => move(id, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Move ${SERVICES[id].name} down`} disabled={at === order.length - 1} onClick={() => move(id, 1)}>
                    <ArrowDown />
                  </Button>
                </span>
              </motion.li>
            ))}
          </ol>
          <AutoHeight>
            {!community && ids.docidAtSigning && ids.services.docid.mode !== "off" ? (
              <p className="flex items-start gap-2 pt-0.5 text-xs text-pretty text-muted-foreground">
                <FileText className="mt-px size-3.5 shrink-0" />
                DOCiDs are minted when the author signs. A report that's declined keeps its Handle, which shows a retired page.
              </p>
            ) : null}
          </AutoHeight>
        </li>
      </ul>
      <AutoHeight>
        {problem ? (
          <p role="alert" className="flex items-center gap-2 ps-1 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            {PROBLEM[problem]}
          </p>
        ) : null}
      </AutoHeight>
    </Zone>
  );
}
