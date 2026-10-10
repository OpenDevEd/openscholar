/**
 * The new extraction being set up (#690): its name, questions, whether it reads PDFs, and the
 * papers it takes. Papers are sources picked from the workspace, each a paper set and the range
 * of it to read, as screening reads them, and PDFs the person uploaded. Kept in the browser, so
 * leaving the page and coming back finds it as it was; sources are a workspace's own, so another
 * workspace starts with none.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Id } from "@/convex/_generated/dataModel";
import type { PaperSet } from "@/lib/screening/setup";
import type { ExtractionQuestion } from "@/lib/types";

/** A source picked: its set, papers `first` to `last` of the `total` it holds, and its name in the tray. A screening is all its included papers. */
export type PickedSource = {
  key: string;
  set: PaperSet;
  first: number;
  last: number;
  scope: "range" | "all";
  total: number;
  label: string;
};

/** A PDF the person uploaded, one paper. */
export type PickedUpload = { storageId: Id<"_storage">; title: string };

interface ExtractionStore {
  draftJob: {
    name: string;
    questions: ExtractionQuestion[];
    usePdfs: boolean;
    /** The workspace the sources and uploads were picked in. */
    workspaceId?: string;
    sources: PickedSource[];
    uploads: PickedUpload[];
  };
  setDraftJobName: (name: string) => void;
  setUsePdfs: (usePdfs: boolean) => void;
  addQuestion: (question: Omit<ExtractionQuestion, "key">) => void;
  removeQuestion: (key: string) => void;
  updateQuestion: (key: string, updates: Partial<ExtractionQuestion>) => void;
  reorderQuestions: (startIndex: number, endIndex: number) => void;
  /** Adds a source, or changes the one with its key in place; picked in another workspace, the others go. */
  setSource: (workspaceId: string, source: PickedSource) => void;
  removeSources: (keys: string[]) => void;
  addUpload: (workspaceId: string, upload: PickedUpload) => void;
  removeUpload: (storageId: Id<"_storage">) => void;
  clearPapers: () => void;
  clearDraftJob: () => void;
}

const emptyDraft: ExtractionStore["draftJob"] = {
  name: "",
  questions: [],
  usePdfs: false,
  sources: [],
  uploads: [],
};

/** The draft's papers, as picked in `workspaceId`: none when they were picked in another. */
const papersIn = (draft: ExtractionStore["draftJob"], workspaceId: string) =>
  draft.workspaceId === workspaceId ? { sources: draft.sources, uploads: draft.uploads } : { sources: [], uploads: [] };

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
      setSource: (workspaceId, source) =>
        set((state) => {
          const { sources, uploads } = papersIn(state.draftJob, workspaceId);
          const at = sources.findIndex((s) => s.key === source.key);
          return { draftJob: { ...state.draftJob, workspaceId, uploads, sources: at === -1 ? [...sources, source] : sources.map((s, i) => (i === at ? source : s)) } };
        }),
      removeSources: (keys) =>
        set((state) => ({ draftJob: { ...state.draftJob, sources: state.draftJob.sources.filter((s) => !keys.includes(s.key)) } })),
      addUpload: (workspaceId, upload) =>
        set((state) => {
          const { sources, uploads } = papersIn(state.draftJob, workspaceId);
          return { draftJob: { ...state.draftJob, workspaceId, sources, uploads: [...uploads.filter((u) => u.storageId !== upload.storageId), upload] } };
        }),
      removeUpload: (storageId) =>
        set((state) => ({ draftJob: { ...state.draftJob, uploads: state.draftJob.uploads.filter((u) => u.storageId !== storageId) } })),
      clearPapers: () =>
        set((state) => ({ draftJob: { ...state.draftJob, sources: [], uploads: [] } })),
      clearDraftJob: () =>
        set({
          draftJob: { ...emptyDraft },
        }),
    }),
    {
      name: "extraction-draft-job",
      version: 5,
      migrate: (persistedState) => {
        // Before v5 papers were picked into a separate bucket, which has gone (#690): a draft keeps
        // its name, questions and PDF choice, and starts with no papers.
        const state = persistedState as { draftJob?: Record<string, unknown> };
        const dj = state?.draftJob ?? {};
        return {
          draftJob: {
            ...emptyDraft,
            name: typeof dj.name === "string" ? dj.name : "",
            questions: Array.isArray(dj.questions) ? (dj.questions as ExtractionQuestion[]) : [],
            usePdfs: typeof dj.usePdfs === "boolean" ? dj.usePdfs : false,
          },
        } as Partial<ExtractionStore>;
      },
    },
  ),
);

/** The draft's papers in the workspace the page is in. */
export const usePickedPapers = (workspaceId: string | undefined) => {
  const draft = useExtractionStore((s) => s.draftJob);
  return workspaceId ? papersIn(draft, workspaceId) : { sources: [], uploads: [] };
};
