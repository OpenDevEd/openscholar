/**
 * Extraction Store
 * Zustand store for managing extraction job state
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExtractionManualItem, ExtractionQuestion, ExtractionZoteroSelection } from "@/lib/types";

interface ExtractionStore {
  draftJob: {
    name: string;
    activeSourceTab: "history" | "zotero" | "manual";
    selectedHistoryIds: string[];
    zoteroSelection: ExtractionZoteroSelection | null;
    manualItems: ExtractionManualItem[];
    questions: ExtractionQuestion[];
  };
  setDraftJobName: (name: string) => void;
  setActiveSourceTab: (tab: "history" | "zotero" | "manual") => void;
  toggleHistorySelection: (historyId: string) => void;
  clearHistorySelections: () => void;
  setZoteroSelection: (selection: ExtractionZoteroSelection | null) => void;
  addManualItem: (item?: Partial<ExtractionManualItem>) => void;
  updateManualItem: (id: string, updates: Partial<ExtractionManualItem>) => void;
  removeManualItem: (id: string) => void;
  clearManualItems: () => void;
  addQuestion: (question: Omit<ExtractionQuestion, "key">) => void;
  removeQuestion: (key: string) => void;
  updateQuestion: (key: string, updates: Partial<ExtractionQuestion>) => void;
  reorderQuestions: (startIndex: number, endIndex: number) => void;
  clearDraftJob: () => void;
}

export const useExtractionStore = create<ExtractionStore>()(
  persist(
    (set) => ({
      draftJob: {
        name: "",
        activeSourceTab: "history",
        selectedHistoryIds: [],
        zoteroSelection: null,
        manualItems: [],
        questions: [],
      },
      setDraftJobName: (name) =>
        set((state) => ({
          draftJob: { ...state.draftJob, name },
        })),
      setActiveSourceTab: (tab) =>
        set((state) => ({
          draftJob: { ...state.draftJob, activeSourceTab: tab },
        })),
      toggleHistorySelection: (historyId) =>
        set((state) => {
          const selected = state.draftJob.selectedHistoryIds;
          const exists = selected.includes(historyId);
          return {
            draftJob: {
              ...state.draftJob,
              selectedHistoryIds: exists
                ? selected.filter((id) => id !== historyId)
                : [...selected, historyId],
            },
          };
        }),
      clearHistorySelections: () =>
        set((state) => ({
          draftJob: { ...state.draftJob, selectedHistoryIds: [] },
        })),
      setZoteroSelection: (selection) =>
        set((state) => ({
          draftJob: { ...state.draftJob, zoteroSelection: selection },
        })),
      addManualItem: (item) =>
        set((state) => {
          const id = item?.id || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const newItem: ExtractionManualItem = {
            id,
            title: item?.title || "",
            abstract: item?.abstract,
            authors: item?.authors,
            year: item?.year,
            doi: item?.doi,
            pdfUrl: item?.pdfUrl,
            storageId: item?.storageId,
          };
          return {
            draftJob: {
              ...state.draftJob,
              manualItems: [...state.draftJob.manualItems, newItem],
            },
          };
        }),
      updateManualItem: (id, updates) =>
        set((state) => ({
          draftJob: {
            ...state.draftJob,
            manualItems: state.draftJob.manualItems.map((item) =>
              item.id === id ? { ...item, ...updates } : item
            ),
          },
        })),
      removeManualItem: (id) =>
        set((state) => ({
          draftJob: {
            ...state.draftJob,
            manualItems: state.draftJob.manualItems.filter((item) => item.id !== id),
          },
        })),
      clearManualItems: () =>
        set((state) => ({
          draftJob: { ...state.draftJob, manualItems: [] },
        })),
      addQuestion: (question) =>
        set((state) => ({
          draftJob: {
            ...state.draftJob,
            questions: [
              ...state.draftJob.questions,
              {
                ...question,
                key: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              },
            ],
          },
        })),
      removeQuestion: (key) =>
        set((state) => ({
          draftJob: {
            ...state.draftJob,
            questions: state.draftJob.questions.filter((q) => q.key !== key),
          },
        })),
      updateQuestion: (key, updates) =>
        set((state) => ({
          draftJob: {
            ...state.draftJob,
            questions: state.draftJob.questions.map((q) =>
              q.key === key ? { ...q, ...updates } : q
            ),
          },
        })),
      reorderQuestions: (startIndex, endIndex) =>
        set((state) => {
          const questions = [...state.draftJob.questions];
          const [removed] = questions.splice(startIndex, 1);
          questions.splice(endIndex, 0, removed);
          return {
            draftJob: { ...state.draftJob, questions },
          };
        }),
      clearDraftJob: () =>
        set({
          draftJob: {
            name: "",
            activeSourceTab: "history",
            selectedHistoryIds: [],
            zoteroSelection: null,
            manualItems: [],
            questions: [],
          },
        }),
    }),
    {
      name: "extraction-draft-job",
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ExtractionStore> | undefined;
        const draftJob = (persisted?.draftJob ?? {}) as Partial<ExtractionStore["draftJob"]>;
        return {
          ...currentState,
          ...persisted,
          draftJob: {
              ...currentState.draftJob,
              ...draftJob,
              activeSourceTab: draftJob.activeSourceTab ?? "history",
              selectedHistoryIds: draftJob.selectedHistoryIds ?? [],
              zoteroSelection: draftJob.zoteroSelection
                ? {
                    ...draftJob.zoteroSelection,
                    includeDescendants: draftJob.zoteroSelection.includeDescendants ?? true,
                  }
                : null,
              manualItems: draftJob.manualItems ?? [],
              questions: draftJob.questions ?? [],
            },
        } as ExtractionStore;
      },
    }
  )
);
