import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage before store import (node environment has no localStorage)
const localStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => localStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStore[key] = value;
  },
  removeItem: (key: string) => {
    delete localStore[key];
  },
});

import {
  useExtractionResultsViewStore,
  migrateViewState,
} from "../lib/store/extraction-results-view";

describe("useExtractionResultsViewStore", () => {
  beforeEach(() => {
    useExtractionResultsViewStore.setState({
      columnVisibility: {},
      activeView: "table",
      _hasHydrated: false,
    });
  });

  it("setColumnVisibility({title: false}) updates columnVisibility", () => {
    useExtractionResultsViewStore.getState().setColumnVisibility({ title: false });
    expect(useExtractionResultsViewStore.getState().columnVisibility).toEqual({
      title: false,
    });
  });

  it("toggleColumn('status') on default state sets {status: false}", () => {
    useExtractionResultsViewStore.getState().toggleColumn("status");
    expect(useExtractionResultsViewStore.getState().columnVisibility).toEqual({
      status: false,
    });
  });

  it("toggleColumn('status') twice restores {status: true}", () => {
    useExtractionResultsViewStore.getState().toggleColumn("status");
    useExtractionResultsViewStore.getState().toggleColumn("status");
    expect(useExtractionResultsViewStore.getState().columnVisibility).toEqual({
      status: true,
    });
  });

  it("setActiveView('card') updates activeView from default 'table'", () => {
    useExtractionResultsViewStore.getState().setActiveView("card");
    expect(useExtractionResultsViewStore.getState().activeView).toBe("card");
  });

  it("setActiveView('split') updates activeView to 'split'", () => {
    useExtractionResultsViewStore.getState().setActiveView("split");
    expect(useExtractionResultsViewStore.getState().activeView).toBe("split");
  });

  it("initial state has _hasHydrated: false, columnVisibility: {}, activeView: 'table'", () => {
    const state = useExtractionResultsViewStore.getState();
    expect(state._hasHydrated).toBe(false);
    expect(state.columnVisibility).toEqual({});
    expect(state.activeView).toBe("table");
  });
});

describe("migrateViewState", () => {
  it("version 0 returns default state regardless of input", () => {
    const result = migrateViewState({ garbage: true }, 0);
    expect(result).toEqual({ columnVisibility: {}, activeView: "table" });
  });

  it("version 1 passes through state unchanged", () => {
    const state = { columnVisibility: { doi: false }, activeView: "card" as const };
    const result = migrateViewState(state, 1);
    expect(result).toBe(state);
  });
});
