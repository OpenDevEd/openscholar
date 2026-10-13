/**
 * The new extraction being set up (#690): its name, questions, whether it reads PDFs, and the
 * papers it takes. Papers are sources picked from the workspace, each a paper set and the range
 * of it to read, as screening reads them, and PDFs the person uploaded. Kept in the browser, so
 * leaving the page and coming back finds it as it was. Papers are kept for each workspace, since
 * a workspace's sources are its own.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Id } from "@/convex/_generated/dataModel";
import type { PaperSet } from "@/lib/screening/setup";
import type { HeldRow } from "@/lib/evidence-libraries/reader-sources";
import type { ExtractionQuestion } from "@/lib/types";

/** A source picked: its set, papers `first` to `last` of the `total` it holds, and its name in the tray. */
export type PickedSource = {
  key: string;
  /** A set the page picked: a Zotero set is one only a chat starts from. */
  set: Exclude<PaperSet, { kind: "zotero" }>;
  first: number;
  last: number;
  scope: "range" | "all";
  total: number;
  label: string;
  /** An Evidence Library's source, with its library, as its list showed it. */
  held?: HeldRow;
};

/** A PDF the person uploaded, one paper. */
type PickedUpload = { storageId: Id<"_storage">; title: string };

/** A workspace's papers in the draft. */
type Papers = { sources: PickedSource[]; uploads: PickedUpload[] };
const NONE: Papers = { sources: [], uploads: [] };

interface ExtractionStore {
  draftJob: {
    name: string;
    questions: ExtractionQuestion[];
    usePdfs: boolean;
    /** Each workspace's papers, by its ID. */
    papers: Record<string, Papers>;
  };
  setDraftJobName: (name: string) => void;
  setUsePdfs: (usePdfs: boolean) => void;
  addQuestion: (question: Omit<ExtractionQuestion, "key">) => void;
  removeQuestion: (key: string) => void;
  updateQuestion: (key: string, updates: Partial<ExtractionQuestion>) => void;
  /** Puts the questions in the order given, the same questions moved. */
  setQuestionOrder: (questions: ExtractionQuestion[]) => void;
  /** Adds a source to the workspace's papers, or changes the one with its key in place. */
  setSource: (workspaceId: string, source: PickedSource) => void;
  removeSources: (workspaceId: string, keys: string[]) => void;
  addUpload: (workspaceId: string, upload: PickedUpload) => void;
  removeUpload: (workspaceId: string, storageId: Id<"_storage">) => void;
  clearPapers: (workspaceId: string) => void;
  /** Starts afresh after a job started in `workspaceId`: its papers go, other workspaces' stay. */
  clearDraftJob: (workspaceId: string) => void;
}

const emptyDraft: ExtractionStore["draftJob"] = {
  name: "",
  questions: [],
  usePdfs: false,
  papers: {},
};

/** The draft with `workspaceId`'s papers changed by `change`. */
const withPapers = (draft: ExtractionStore["draftJob"], workspaceId: string, change: (papers: Papers) => Papers) => ({
  draftJob: { ...draft, papers: { ...draft.papers, [workspaceId]: change(draft.papers[workspaceId] ?? NONE) } },
});

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
      setQuestionOrder: (questions) => set((state) => ({ draftJob: { ...state.draftJob, questions } })),
      setSource: (workspaceId, source) =>
        set((state) =>
          withPapers(state.draftJob, workspaceId, ({ sources, uploads }) => {
            const at = sources.findIndex((s) => s.key === source.key);
            return { uploads, sources: at === -1 ? [...sources, source] : sources.map((s, i) => (i === at ? source : s)) };
          }),
        ),
      removeSources: (workspaceId, keys) => set((state) => withPapers(state.draftJob, workspaceId, ({ sources, uploads }) => ({ uploads, sources: sources.filter((s) => !keys.includes(s.key)) }))),
      // A workspace's own: an upload that finishes after the page moved to another lands in the one it was made in.
      addUpload: (workspaceId, upload) => set((state) => withPapers(state.draftJob, workspaceId, ({ sources, uploads }) => ({ sources, uploads: [...uploads.filter((u) => u.storageId !== upload.storageId), upload] }))),
      removeUpload: (workspaceId, storageId) => set((state) => withPapers(state.draftJob, workspaceId, ({ sources, uploads }) => ({ sources, uploads: uploads.filter((u) => u.storageId !== storageId) }))),
      clearPapers: (workspaceId) => set((state) => withPapers(state.draftJob, workspaceId, () => NONE)),
      clearDraftJob: (workspaceId) =>
        set((state) => {
          const { [workspaceId]: _started, ...papers } = state.draftJob.papers;
          return { draftJob: { ...emptyDraft, papers } };
        }),
    }),
    {
      name: "extraction-draft-job",
      version: 6,
      migrate: (persistedState) => {
        // Before v5 papers were picked into a separate bucket, which has gone (#690), and v5 kept one
        // workspace's: a draft keeps its name, questions and PDF choice, and starts with no papers.
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
export const usePickedPapers = (workspaceId: string | undefined) => useExtractionStore((s) => (workspaceId && s.draftJob.papers[workspaceId]) || NONE);
