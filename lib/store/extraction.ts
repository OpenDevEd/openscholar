/**
 * Extraction Store
 * Zustand store for managing extraction job state
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExtractionQuestion } from "@/lib/types";

interface ExtractionStore {
  draftJob: {
    name: string;
    selectedHistoryId: string | null;
    questions: ExtractionQuestion[];
  };
  setDraftJobName: (name: string) => void;
  setSelectedHistoryId: (historyId: string | null) => void;
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
        selectedHistoryId: null,
        questions: [],
      },
      setDraftJobName: (name) =>
        set((state) => ({
          draftJob: { ...state.draftJob, name },
        })),
      setSelectedHistoryId: (historyId) =>
        set((state) => ({
          draftJob: { ...state.draftJob, selectedHistoryId: historyId },
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
            selectedHistoryId: null,
            questions: [],
          },
        }),
    }),
    {
      name: "extraction-draft-job",
    }
  )
);
