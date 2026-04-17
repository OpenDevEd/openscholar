/**
 * Extraction draft-job store. After the bucket refactor (P4), the only
 * draft-job state this store holds is the job name and the question set.
 * Paper selection lives in lib/store/bucket.ts and is its own slice.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExtractionQuestion } from "@/lib/types";

interface ExtractionStore {
  draftJob: {
    name: string;
    questions: ExtractionQuestion[];
  };
  setDraftJobName: (name: string) => void;
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
        questions: [],
      },
      setDraftJobName: (name) =>
        set((state) => ({
          draftJob: { ...state.draftJob, name },
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
          draftJob: {
            name: "",
            questions: [],
          },
        }),
    }),
    {
      name: "extraction-draft-job",
      version: 2,
      migrate: (persistedState) => {
        // v1 carried selectedHistoryIds/zoteroSelection/manualItems.
        // Drop them — bucket store owns paper selection now.
        const state = persistedState as { draftJob?: Record<string, unknown> };
        const dj = state?.draftJob ?? {};
        return {
          draftJob: {
            name: typeof dj.name === "string" ? dj.name : "",
            questions: Array.isArray(dj.questions)
              ? (dj.questions as ExtractionQuestion[])
              : [],
          },
        } as Partial<ExtractionStore>;
      },
    },
  ),
);
