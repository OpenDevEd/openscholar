/**
 * Extraction draft-job store. Holds the in-progress JobCreator state:
 * name, mode (extraction | chat), questions (extraction-mode only),
 * chatModelId (chat-mode only), usePdfs (extraction-mode only).
 *
 * Paper selection is a separate slice — see lib/store/bucket.ts.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Id } from "@/convex/_generated/dataModel";
import type { ExtractionQuestion } from "@/lib/types";

export type JobMode = "extraction" | "chat";

interface ExtractionStore {
  draftJob: {
    name: string;
    mode: JobMode;
    questions: ExtractionQuestion[];
    chatModelId: Id<"models"> | null;
    usePdfs: boolean;
  };
  setDraftJobName: (name: string) => void;
  setMode: (mode: JobMode) => void;
  setChatModelId: (id: Id<"models"> | null) => void;
  setUsePdfs: (usePdfs: boolean) => void;
  addQuestion: (question: Omit<ExtractionQuestion, "key">) => void;
  removeQuestion: (key: string) => void;
  updateQuestion: (key: string, updates: Partial<ExtractionQuestion>) => void;
  reorderQuestions: (startIndex: number, endIndex: number) => void;
  clearDraftJob: () => void;
}

const emptyDraft: ExtractionStore["draftJob"] = {
  name: "",
  mode: "extraction",
  questions: [],
  chatModelId: null,
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
      setMode: (mode) =>
        set((state) => ({
          draftJob: {
            ...state.draftJob,
            mode,
            // Switching to chat abandons extraction-only state so a submit
            // can't silently carry orphaned questions or a PDF opt-in.
            // Switching to extraction drops the chat model pick.
            questions: mode === "chat" ? [] : state.draftJob.questions,
            usePdfs: mode === "chat" ? false : state.draftJob.usePdfs,
            chatModelId:
              mode === "extraction" ? null : state.draftJob.chatModelId,
          },
        })),
      setChatModelId: (id) =>
        set((state) => ({
          draftJob: { ...state.draftJob, chatModelId: id },
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
      version: 3,
      migrate: (persistedState, version) => {
        // v1 carried selectedHistoryIds/zoteroSelection/manualItems — dropped
        // when bucket store became the single source of truth for paper
        // selection. v3 adds P9 fields (mode, chatModelId, usePdfs).
        const state = persistedState as { draftJob?: Record<string, unknown> };
        const dj = state?.draftJob ?? {};
        const mode =
          dj.mode === "chat" || dj.mode === "extraction"
            ? (dj.mode as JobMode)
            : "extraction";
        return {
          draftJob: {
            name: typeof dj.name === "string" ? dj.name : "",
            mode,
            questions: Array.isArray(dj.questions)
              ? (dj.questions as ExtractionQuestion[])
              : [],
            chatModelId:
              (dj.chatModelId as Id<"models"> | null | undefined) ?? null,
            usePdfs: typeof dj.usePdfs === "boolean" ? dj.usePdfs : false,
          },
        } as Partial<ExtractionStore>;
        void version;
      },
    },
  ),
);
