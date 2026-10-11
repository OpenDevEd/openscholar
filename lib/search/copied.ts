import { create } from "zustand";

/**
 * Searches this tab made from a link to a search the person can't open (#653): each is their own
 * copy of its query and filters, and its page says so until the tab is closed.
 */
export const useCopiedSearches = create<{ ids: string[] }>(() => ({ ids: [] }));
