"use client";

import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { pickSearchSource, SEARCH_SOURCES, useSearchSource, type SearchSourceId } from "@/components/search-source";
import { showConfirmation } from "@/lib/confirmation";

/** Which source every search on the site reads from. It changes search for everyone, so a change asks first. */
export function SearchSourceZone() {
  const active = useSearchSource();
  const ask = (id: SearchSourceId) => {
    if (id === active.id) return;
    const name = SEARCH_SOURCES.find((source) => source.id === id)!.name;
    showConfirmation({
      title: `Search with ${name}?`,
      message: "Search changes for everyone straight away. Jobs already running finish on the source they started with.",
      confirmText: `Use ${name}`,
      variant: "default",
      onConfirm: () => pickSearchSource(id),
    });
  };
  return (
    <Zone label="Search">
      <ul className={LIST}>
        <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Search source</span>
            <span className="block text-xs text-muted-foreground">Every search on the site reads from this source.</span>
          </span>
          <Segmented
            label="Search source"
            value={active.id}
            onChange={ask}
            options={SEARCH_SOURCES.map((source) => ({ id: source.id, label: source.name, icon: source.icon }))}
          />
        </li>
      </ul>
    </Zone>
  );
}
