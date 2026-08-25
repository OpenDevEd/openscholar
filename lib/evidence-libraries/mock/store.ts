"use client";

/**
 * In-memory store for the Evidence Library design prototype.
 * Timers live here (an outside system), so components never need effects.
 */

import { create } from "zustand";
import { toast } from "sonner";
import {
  ACTIVATION_STAGES,
  type ActivationRun,
  addressFor,
  clockTime,
  colorForIndex,
  dateStamp,
  isDirty,
  type LibraryConfig,
  makeConfig,
  makeSteps,
  type MockLibrary,
  MOCK_ORGANIZATIONS,
  newLibraryId,
  newRevisionId,
  seedLibraries,
  SETUP_STEP_KEYS,
} from "./data";

const STEP_INTERVAL_MS = 1500;
const ACTIVATION_INTERVAL_MS = 1500;
const DELETE_INTERVAL_MS = 1000;
const SAVE_MS = 800;
const RESERVE_MS = 1000;

type MockState = {
  orgId: string;
  libraries: MockLibrary[];
  /** libraryId -> current activation run */
  activation: Record<string, ActivationRun>;
  /** libraryId -> delete progress percent */
  deleting: Record<string, number>;
  /** libraryId -> a save is in flight */
  saving: Record<string, boolean>;
  /** A reserve check is in flight on the create page. */
  reserving: boolean;

  switchOrganization: (orgId: string) => void;
  createLibrary: (name: string, shortName: string) => string;
  reserveAddress: (shortName: string) => Promise<{ taken: boolean }>;
  updateDraft: (libraryId: string, patch: Partial<LibraryConfig>) => void;
  saveDraft: (libraryId: string) => void;
  startSetup: (libraryId: string) => void;
  retrySetup: (libraryId: string) => void;
  startActivation: (libraryId: string) => void;
  deleteLibrary: (libraryId: string) => void;
};

const setupTimers = new Map<string, ReturnType<typeof setInterval>>();

function patchLibrary(
  libraries: MockLibrary[],
  libraryId: string,
  update: (library: MockLibrary) => MockLibrary,
) {
  return libraries.map((l) => (l.id === libraryId ? update(l) : l));
}

export const useEvidenceLibraryMockStore = create<MockState>((set, get) => {
  const find = (libraryId: string) =>
    get().libraries.find((l) => l.id === libraryId);

  const tickSetup = (libraryId: string) => {
    const library = find(libraryId);
    if (!library) {
      stopSetupTimer(libraryId);
      return;
    }
    const index = library.steps.findIndex((s) => s.status !== "done");
    if (index === -1) {
      stopSetupTimer(libraryId);
      return;
    }
    const key = SETUP_STEP_KEYS[index];

    if (key === "deployment" && library.failNextDeployment) {
      stopSetupTimer(libraryId);
      set((state) => ({
        libraries: patchLibrary(state.libraries, libraryId, (l) => ({
          ...l,
          status: "setup_failed",
          failNextDeployment: false,
          steps: l.steps.map((s, i) =>
            i === index ? { ...s, status: "failed", at: clockTime() } : s,
          ),
        })),
      }));
      toast.error("Setup failed", {
        description: `${library.name}: the deployment step did not finish.`,
      });
      return;
    }

    const isLast = index === SETUP_STEP_KEYS.length - 1;
    set((state) => ({
      libraries: patchLibrary(state.libraries, libraryId, (l) => {
        const steps = l.steps.map((s, i) => {
          if (i === index) return { ...s, status: "done" as const, at: clockTime() };
          if (i === index + 1) return { ...s, status: "running" as const };
          return s;
        });
        if (!isLast) return { ...l, steps };
        return {
          ...l,
          steps,
          status: "active",
          activeRev: l.draftRev,
          draftRev: newRevisionId(),
          lastActivated: dateStamp(),
        };
      }),
    }));
    if (isLast) {
      stopSetupTimer(libraryId);
      toast.success("Library is live", {
        description: `${library.name} is now at ${library.address}`,
      });
    }
  };

  const stopSetupTimer = (libraryId: string) => {
    const timer = setupTimers.get(libraryId);
    if (timer) clearInterval(timer);
    setupTimers.delete(libraryId);
  };

  const startSetup = (libraryId: string) => {
    if (setupTimers.has(libraryId)) return;
    const library = find(libraryId);
    if (!library || library.status === "active" || library.status === "deleting") {
      return;
    }
    set((state) => ({
      libraries: patchLibrary(state.libraries, libraryId, (l) => {
        const firstOpen = l.steps.findIndex((s) => s.status !== "done");
        return {
          ...l,
          status: "setting_up",
          steps: l.steps.map((s, i) =>
            i === firstOpen ? { ...s, status: "running" } : s,
          ),
        };
      }),
    }));
    setupTimers.set(
      libraryId,
      setInterval(() => tickSetup(libraryId), STEP_INTERVAL_MS),
    );
  };

  return {
    orgId: MOCK_ORGANIZATIONS[0].id,
    libraries: seedLibraries(),
    activation: {},
    deleting: {},
    saving: {},
    reserving: false,

    switchOrganization(orgId) {
      set({ orgId });
    },

    reserveAddress(shortName) {
      set({ reserving: true });
      return new Promise((resolve) => {
        setTimeout(() => {
          set({ reserving: false });
          resolve({
            taken: get().libraries.some((l) => l.shortName === shortName),
          });
        }, RESERVE_MS);
      });
    },

    createLibrary(name, shortName) {
      const id = newLibraryId();
      const saved = makeConfig(name, shortName);
      set((state) => ({
        libraries: [
          ...state.libraries,
          {
            id,
            orgId: state.orgId,
            name,
            shortName,
            address: addressFor(shortName),
            status: "draft",
            activeRev: null,
            draftRev: newRevisionId(),
            lastActivated: null,
            color: colorForIndex(state.libraries.length),
            steps: makeSteps(0, false),
            failNextDeployment: false,
            saved,
            draft: structuredClone(saved),
          },
        ],
      }));
      return id;
    },

    updateDraft(libraryId, patch) {
      set((state) => ({
        libraries: patchLibrary(state.libraries, libraryId, (l) => {
          const draft = { ...l.draft, ...patch };
          if (!draft.languages.includes(draft.defaultLanguage)) {
            draft.defaultLanguage = draft.languages[0] ?? "";
          }
          return { ...l, draft };
        }),
      }));
    },

    saveDraft(libraryId) {
      set((state) => ({ saving: { ...state.saving, [libraryId]: true } }));
      setTimeout(() => {
        let savedRev = "";
        set((state) => ({
          saving: { ...state.saving, [libraryId]: false },
          libraries: patchLibrary(state.libraries, libraryId, (l) => {
            savedRev = newRevisionId();
            return {
              ...l,
              saved: structuredClone(l.draft),
              name: l.draft.name,
              draftRev: savedRev,
            };
          }),
        }));
        toast.success("Saved", {
          description: `Draft ${savedRev} saved. Activate to make it public.`,
        });
      }, SAVE_MS);
    },

    startSetup(libraryId) {
      const library = find(libraryId);
      if (library && isDirty(library)) {
        set((state) => ({
          libraries: patchLibrary(state.libraries, libraryId, (l) => ({
            ...l,
            saved: structuredClone(l.draft),
            name: l.draft.name,
          })),
        }));
      }
      startSetup(libraryId);
    },

    retrySetup(libraryId) {
      set((state) => ({
        libraries: patchLibrary(state.libraries, libraryId, (l) => ({
          ...l,
          steps: l.steps.map((s) =>
            s.status === "failed" ? { ...s, status: "waiting", at: "" } : s,
          ),
        })),
      }));
      startSetup(libraryId);
    },

    startActivation(libraryId) {
      const library = find(libraryId);
      if (!library || get().activation[libraryId]) return;
      const rev = library.draftRev;
      set((state) => ({
        activation: { ...state.activation, [libraryId]: { stageIndex: 0, rev } },
        libraries: patchLibrary(state.libraries, libraryId, (l) =>
          isDirty(l)
            ? { ...l, saved: structuredClone(l.draft), name: l.draft.name }
            : l,
        ),
      }));
      const timer = setInterval(() => {
        const run = get().activation[libraryId];
        if (!run) {
          clearInterval(timer);
          return;
        }
        const next = run.stageIndex + 1;
        const live = next >= ACTIVATION_STAGES.length - 1;
        set((state) => ({
          activation: {
            ...state.activation,
            [libraryId]: { ...run, stageIndex: next },
          },
          libraries: live
            ? patchLibrary(state.libraries, libraryId, (l) => ({
                ...l,
                activeRev: rev,
                draftRev: newRevisionId(),
                lastActivated: dateStamp(),
                saved: structuredClone(l.draft),
              }))
            : state.libraries,
        }));
        if (live) {
          clearInterval(timer);
          const current = find(libraryId);
          toast.success("Library updated", {
            description: `${rev} is live at ${current?.address ?? ""}`,
          });
          setTimeout(() => {
            set((state) => {
              const activation = { ...state.activation };
              delete activation[libraryId];
              return { activation };
            });
          }, 2500);
        }
      }, ACTIVATION_INTERVAL_MS);
    },

    deleteLibrary(libraryId) {
      const library = find(libraryId);
      if (!library) return;
      stopSetupTimer(libraryId);
      set((state) => ({
        deleting: { ...state.deleting, [libraryId]: 5 },
        libraries: patchLibrary(state.libraries, libraryId, (l) => ({
          ...l,
          status: "deleting",
        })),
      }));
      const timer = setInterval(() => {
        const percent = Math.min(100, (get().deleting[libraryId] ?? 0) + 25);
        if (percent >= 100) {
          clearInterval(timer);
          set((state) => {
            const deleting = { ...state.deleting };
            delete deleting[libraryId];
            return {
              deleting,
              libraries: state.libraries.filter((l) => l.id !== libraryId),
            };
          });
          toast.success("Library deleted", {
            description: `${library.name} and its address are gone.`,
          });
          return;
        }
        set((state) => ({ deleting: { ...state.deleting, [libraryId]: percent } }));
      }, DELETE_INTERVAL_MS);
    },
  };
});

// The seeded "Setting up" library is mid-setup, so its timer starts as soon as
// the prototype loads in the browser. It fails once at Deployment; Retry works.
if (typeof window !== "undefined") {
  setTimeout(() => {
    useEvidenceLibraryMockStore.getState().startSetup("lib_2");
  }, 0);
}

export const selectOrganization = (state: MockState) =>
  MOCK_ORGANIZATIONS.find((o) => o.id === state.orgId) ?? MOCK_ORGANIZATIONS[0];

export const selectLibrary = (libraryId: string) => (state: MockState) =>
  state.libraries.find((l) => l.id === libraryId) ?? null;
