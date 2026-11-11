"use client";

// Finding a person's ORCID iD on ORCID. A report's details form and the profile setup share it.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import useSWR from "swr";
import { OrcidIcon } from "@/components/icons/author-service-icons";
import { CircleX, Check, ChevronDown, ExternalLink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TooltipHint } from "@/components/ui/tooltip";
import { findOrcid } from "@/app/actions/people-lookup";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { isOrcid } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/** An ORCID iD as typed or pasted, alone or as its orcid.org address, whether or not its check digit is right. */
function orcidShaped(text: string) {
  const id = text.trim().replace(/^https?:\/\/(www\.)?orcid\.org\//i, "").toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id) ? id : null;
}

/** An ORCID iD with its check digit right, from the iD or its orcid.org address as typed or pasted. */
export function orcidIn(text: string) {
  const id = orcidShaped(text);
  return id && isOrcid(id) ? id : null;
}

/** A person's institutions as one short line: the first two, and how many more. */
function usePlacesOf() {
  const t = useTranslations("people");
  const format = useFormatter();
  return (institutions: string[]) => {
    const two = format.list(institutions.slice(0, 2), { type: "conjunction" });
    return institutions.length > 2 ? t("placesMore", { places: two, more: institutions.length - 2 }) : two;
  };
}

/**
 * The people on ORCID for the words typed, which start as the person's name, those at their institutions first, with
 * an iD typed or pasted as the first choice. It lives inside a popover, so it starts afresh each time that opens.
 */
export function OrcidSearch({ name, institutions, current, onPick, onRemove }: { name: string; institutions: string[]; /** The iD chosen so far, or empty. */ current: string; onPick: (orcid: string, name: string) => void; onRemove: () => void }) {
  const t = useTranslations("people");
  const placesOf = usePlacesOf();
  const [search, setSearch] = useState(name.trim());
  const query = useDebouncedValue(search.trim(), 300);
  const shaped = orcidShaped(search);
  const typed = shaped && isOrcid(shaped) ? shaped : null;
  // An iD with a digit wrong is no one's name: it isn't searched for, and the list says so.
  const mistyped = !!shaped && !typed;
  const at = institutions;
  // Words to look people up by: never an iD, typed now or still in the debounced words.
  const lookup = query && !shaped && !orcidShaped(query) ? query : "";
  const people = useSWR(lookup ? ["orcid", lookup, ...at] : null, () => findOrcid(lookup, at), { keepPreviousData: true, revalidateOnFocus: false });
  // The results on screen are for other words, or are being asked again: they wait for the answer to what's typed.
  const searching = !shaped && !!search.trim() && (search.trim() !== query || people.isValidating);
  // A failed search keeps the last one's people on screen, which are for other words too.
  const stale = searching || (!typed && !!people.error);
  // Someone at one of the person's institutions shows that institution first.
  const theirs = new Set(at.map((name) => name.toLowerCase()));
  const shown = (lookup ? (people.data ?? []) : []).map((person) => ({ ...person, institutions: [...person.institutions].sort((a, b) => Number(theirs.has(b.toLowerCase())) - Number(theirs.has(a.toLowerCase()))) }));
  const groups = [
    { heading: at.length === 1 ? t("atOne", { institution: at[0] }) : t("atTheirs"), people: shown.filter((person) => person.near) },
    { heading: shown.some((person) => person.near) ? t("elsewhere") : t("onOrcid"), people: shown.filter((person) => !person.near) },
  ].filter((group) => group.people.length);
  return (
    <Command shouldFilter={false}>
      <CommandInput value={search} onValueChange={setSearch} placeholder={t("searchPlaceholder")} busy={searching} />
      <CommandList grows>
        {mistyped ? (
          // Said whatever else the list holds: Open and Remove stay for an iD already chosen, so this can't be its empty state.
          <div role="option" aria-disabled="true" aria-selected="false" className="py-6 text-center text-sm">
            {t("notOrcid")}
          </div>
        ) : (
          <CommandEmpty>{!search.trim() ? t("typeName") : people.error ? t("orcidDown") : searching || people.isLoading ? t("searching") : t("nobody")}</CommandEmpty>
        )}
        {typed ? (
          <CommandGroup>
            <CommandItem value={`typed ${typed}`} onSelect={() => onPick(typed, "")}>
              <OrcidIcon />
              <span className="font-mono text-xs">{typed}</span>
              <span className="ms-auto text-xs text-muted-foreground">{t("asTyped")}</span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading} className={cn("transition-opacity", stale && "opacity-60")}>
            {group.people.map((person) => (
              // People found for words since changed can't be picked: Enter never takes someone from the last search.
              <CommandItem key={person.orcid} value={person.orcid} disabled={stale} onSelect={() => onPick(person.orcid, person.name)} className="items-start">
                <Check className={cn("mt-0.5 size-4", person.orcid === current ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{person.name || t("noName")}</span>
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">{person.orcid}</span>
                  </span>
                  {person.institutions.length ? (
                    <TooltipHint label={placesOf(person.institutions)} onlyWhenClipped>
                      <span className="block truncate text-xs text-muted-foreground">{placesOf(person.institutions)}</span>
                    </TooltipHint>
                  ) : (
                    <span className="block text-xs text-subtle-foreground">{t("noInstitution")}</span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {current ? (
          <CommandGroup>
            <CommandItem value="open" onSelect={() => window.open(`https://orcid.org/${current}`, "_blank", "noopener")}>
              <ExternalLink />
              {t("open", { orcid: current })}
            </CommandItem>
            <CommandItem value="remove" onSelect={onRemove} className="text-destructive data-[selected=true]:text-destructive">
              <CircleX className="text-destructive" />
              {t("remove")}
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
}

/** The box an ORCID iD is chosen in: the iD once there is one, and opening the search either way. */
export function OrcidButton({ orcid, open, className, ...props }: { orcid: string; open: boolean } & React.ComponentProps<typeof Button>) {
  const t = useTranslations("people");
  return (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-label={orcid ? t("orcidLabel", { orcid }) : t("find")}
      {...props}
      className={cn("h-9 justify-start gap-2 px-2.5 font-normal", className)}
    >
      <OrcidIcon />
      {orcid ? <span className="truncate font-mono text-xs">{orcid}</span> : <span className="truncate text-subtle-foreground">{t("find")}</span>}
      <ChevronDown className="ms-auto size-4 shrink-0 opacity-50" />
    </Button>
  );
}
