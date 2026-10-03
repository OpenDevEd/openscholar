"use client";

import { useState } from "react";

/** One page of an account's list as `useCursorPage` reads it. */
type RemotePage<Item> = { items: Item[]; page: number; offset: number; canPrevious: boolean; canNext: boolean; hasPages: boolean; isLoading: boolean; isStale: boolean; previous: () => void; next: () => void };

/**
 * A page of someone's records, stepped with previous and next, in one shape whether it comes
 * from the account (`remote`, read a page at a time, with `count` records in all) or from
 * this browser (`local`, already filtered and sorted). `counted` is false when the account's
 * list is filtered, since its matches aren't counted: `total` and `pageCount` are then
 * undefined. `count` is every record the person has, whatever the filter. `localKey` names
 * the browser's list, so its page starts over when the filter or sort changes.
 */
export function usePagedRecords<Item>({ remote, count, counted, local, localCount, localKey, pageSize }: {
  remote: RemotePage<Item> | null;
  count: number | undefined;
  counted: boolean;
  local: Item[];
  localCount: number;
  localKey: string;
  pageSize: number;
}) {
  const [localPage, setLocalPage] = useState({ key: localKey, page: 1 });
  if (remote) {
    // A page still catching up with a deletion can hold more than the count says; the total never reads below it.
    const total = !counted || count === undefined ? undefined : Math.max(count, remote.offset + remote.items.length);
    return { ...remote, count, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)) };
  }
  const pageCount = Math.max(1, Math.ceil(local.length / pageSize));
  const page = Math.min(localPage.key === localKey ? localPage.page : 1, pageCount);
  const offset = (page - 1) * pageSize;
  return {
    items: local.slice(offset, offset + pageSize),
    count: localCount,
    total: local.length,
    page,
    pageCount,
    offset,
    canPrevious: page > 1,
    canNext: page < pageCount,
    hasPages: pageCount > 1,
    isLoading: false,
    isStale: false,
    previous: () => setLocalPage({ key: localKey, page: Math.max(1, page - 1) }),
    next: () => setLocalPage({ key: localKey, page: Math.min(pageCount, page + 1) }),
  };
}
