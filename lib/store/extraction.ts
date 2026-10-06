/**
 * Extraction draft-job store. Holds the in-progress JobCreator state:
 * name, questions and usePdfs.
 *
 * Paper selection is a separate slice — see lib/store/bucket.ts.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExtractionQuestion } from "@/lib/types";

interface ExtractionStore {
  draftJob: {
    name: string;
    questions: ExtractionQuestion[];
    usePdfs: boolean;
  };
  setDraftJobName: (name: string) => void;
  setUsePdfs: (usePdfs: boolean) => void;
  addQuestion: (question: Omit<ExtractionQuestion, "key">) => void;
  removeQuestion: (key: string) => void;
  updateQuestion: (key: string, updates: Partial<ExtractionQuestion>) => void;
  reorderQuestions: (startIndex: number, endIndex: number) => void;
  clearDraftJob: () => void;
}

const emptyDraft: ExtractionStore["draftJob"] = {
  name: "",
  questions: [],
  usePdfs: false,
};

export const useExtractionStore = create<ExtractionStore>()(
  persist(
    (set) => ({
      draftJob: { ...emptyDraft },
      setDraftJobName: (name) =>
        set((state) => ({
          draftJob: { ...state.draftJob, name },
        })),
      setUsePdfs: (usePdfs) =>
        set((state) => ({
          draftJob: { ...state.draftJob, usePdfs },
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
              q.key === key ? { ...q, ...updates } : q,
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
          draftJob: { ...emptyDraft },
        }),
    }),
    {
      name: "extraction-draft-job",
      version: 4,
      migrate: (persistedState, version) => {
        // v1 carried selectedHistoryIds/zoteroSelection/manualItems — dropped
        // when bucket store became the single source of truth for paper
        // selection. v4 drops the chat mode and its model pick.
        const state = persistedState as { draftJob?: Record<string, unknown> };
        const dj = state?.draftJob ?? {};
        return {
          draftJob: {
            name: typeof dj.name === "string" ? dj.name : "",
            questions: Array.isArray(dj.questions)
              ? (dj.questions as ExtractionQuestion[])
              : [],
            usePdfs: typeof dj.usePdfs === "boolean" ? dj.usePdfs : false,
          },
        } as Partial<ExtractionStore>;
        void version;
      },
    },
  ),
);
