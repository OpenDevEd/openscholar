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
  changedSections,
  isDirty,
  type LibraryConfig,
  makeConfig,
  resetSection,
  type SectionKey,
  makeSteps,
  type MockLibrary,
  MOCK_ORGANIZATIONS,
  newLibraryId,
  newRevisionId,
  seedLibraries,
  SETUP_STEP_KEYS,
} from "./data";
import { FILE_LIMITS, type FileKind, type MockFile } from "./config";

const STEP_INTERVAL_MS = 1500;
const ACTIVATION_INTERVAL_MS = 1500;
const DELETE_INTERVAL_MS = 1000;
const SAVE_MS = 800;
const RESERVE_MS = 1000;
const UPLOAD_MS = 1200;
const SYNC_MS = 700;
const DNS_MS = 1800;
const INVITE_MS = 3000;
const PAUSE_MS = 1500;

export type UploadResult = { ok: true; file: MockFile } | { ok: false; error: "type" | "size" };
export type SyncRun = { percent: number; sourceId: string };

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
  /** upload slot key -> percent */
  uploads: Record<string, number>;
  /** libraryId -> running Zotero sync */
  syncing: Record<string, SyncRun>;
  /** libraryId -> pause/unpause in flight */
  pausing: Record<string, boolean>;

  switchOrganization: (orgId: string) => void;
  createLibrary: (name: string, shortName: string) => string;
  reserveAddress: (shortName: string) => Promise<{ taken: boolean }>;
  updateDraft: (libraryId: string, update: (draft: LibraryConfig) => LibraryConfig) => void;
  resetSection: (libraryId: string, key: SectionKey) => void;
  uploadFile: (slot: string, kind: FileKind, file: File) => Promise<UploadResult>;
  syncSource: (libraryId: string, sourceId: string) => void;
  checkDns: (libraryId: string) => void;
  invite: (libraryId: string, grantId: string) => void;
  restoreVersion: (libraryId: string, rev: string) => void;
  togglePause: (libraryId: string) => void;
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
    uploads: {},
    syncing: {},
    pausing: {},

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
            versions: [],
            paused: false,
          },
        ],
      }));
      return id;
    },

    updateDraft(libraryId, update) {
      set((state) => ({
        libraries: patchLibrary(state.libraries, libraryId, (l) => {
          const draft = update(structuredClone(l.draft));
          const loc = draft.localization;
          if (!loc.locales.includes(loc.defaultLocale)) {
            loc.defaultLocale = loc.locales[0] ?? "";
          }
          loc.priority = [
            ...loc.priority.filter((c) => loc.locales.includes(c)),
            ...loc.locales.filter((c) => !loc.priority.includes(c)),
          ];
          return { ...l, draft };
        }),
      }));
    },

    resetSection(libraryId, key) {
      set((state) => ({
        libraries: patchLibrary(state.libraries, libraryId, (l) => ({
          ...l,
          draft: resetSection(l, key),
        })),
      }));
    },

    uploadFile(slot, kind, file) {
      const limit = FILE_LIMITS[kind];
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      const typeOk = (limit.accept as readonly string[]).some(
        (a) => a === file.type || a === ext,
      );
      if (!typeOk) return Promise.resolve({ ok: false, error: "type" });
      if (file.size > limit.maxBytes) return Promise.resolve({ ok: false, error: "size" });
      set((state) => ({ uploads: { ...state.uploads, [slot]: 5 } }));
      return new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const percent = Math.min(95, Math.round(((Date.now() - started) / UPLOAD_MS) * 100));
          set((state) => ({ uploads: { ...state.uploads, [slot]: percent } }));
        }, 100);
        const finish = (text?: string) => {
          clearInterval(timer);
          set((state) => {
            const uploads = { ...state.uploads };
            delete uploads[slot];
            return { uploads };
          });
          resolve({
            ok: true,
            file: { name: file.name, size: file.size, url: URL.createObjectURL(file), text },
          });
        };
        setTimeout(() => {
          if (kind === "legal") {
            file.text().then((text) => finish(text));
          } else {
            finish();
          }
        }, UPLOAD_MS);
      });
    },

    syncSource(libraryId, sourceId) {
      if (get().syncing[libraryId]) return;
      set((state) => ({ syncing: { ...state.syncing, [libraryId]: { percent: 0, sourceId } } }));
      const timer = setInterval(() => {
        const run = get().syncing[libraryId];
        if (!run) {
          clearInterval(timer);
          return;
        }
        const percent = Math.min(100, run.percent + 20);
        if (percent >= 100) {
          clearInterval(timer);
          let label = "";
          set((state) => {
            const syncing = { ...state.syncing };
            delete syncing[libraryId];
            return {
              syncing,
              libraries: patchLibrary(state.libraries, libraryId, (l) => {
                const bump = (c: LibraryConfig) => ({
                  ...c,
                  sources: {
                    ...c.sources,
                    zotero: c.sources.zotero.map((z) => {
                      if (z.id !== sourceId) return z;
                      label = z.label;
                      return { ...z, lastSync: dateStamp(), records: z.records + 3 };
                    }),
                  },
                });
                return { ...l, draft: bump(l.draft), saved: bump(l.saved) };
              }),
            };
          });
          toast.success("Sync finished", { description: `${label}: 3 new records.` });
          return;
        }
        set((state) => ({ syncing: { ...state.syncing, [libraryId]: { ...run, percent } } }));
      }, SYNC_MS);
    },

    checkDns(libraryId) {
      const setStatus = (status: LibraryConfig["domain"]["status"]) =>
        set((state) => ({
          libraries: patchLibrary(state.libraries, libraryId, (l) => ({
            ...l,
            draft: { ...l.draft, domain: { ...l.draft.domain, status } },
          })),
        }));
      setStatus("checking");
      setTimeout(() => {
        const library = find(libraryId);
        const host = library?.draft.domain.custom ?? "";
        // Anything ending in ".test" fails, so the failure state can be seen.
        const ok = !host.endsWith(".test");
        setStatus(ok ? "verified" : "failed");
        if (ok) {
          toast.success("Domain verified", { description: `${host} points to this library.` });
        } else {
          toast.error("DNS records not found", { description: `Add the records for ${host} and check again.` });
        }
      }, DNS_MS);
    },

    invite(libraryId, grantId) {
      setTimeout(() => {
        set((state) => ({
          libraries: patchLibrary(state.libraries, libraryId, (l) => {
            const accept = (c: LibraryConfig) => ({
              ...c,
              team: {
                ...c.team,
                grants: c.team.grants.map((g) =>
                  g.id === grantId ? { ...g, status: "active" as const } : g,
                ),
              },
            });
            return { ...l, draft: accept(l.draft), saved: accept(l.saved) };
          }),
        }));
      }, INVITE_MS);
    },

    restoreVersion(libraryId, rev) {
      const library = find(libraryId);
      if (!library) return;
      set((state) => ({
        libraries: patchLibrary(state.libraries, libraryId, (l) => ({ ...l, draftRev: rev })),
      }));
      get().startActivation(libraryId);
    },

    togglePause(libraryId) {
      const library = find(libraryId);
      if (!library) return;
      set((state) => ({ pausing: { ...state.pausing, [libraryId]: true } }));
      setTimeout(() => {
        const paused = !library.paused;
        set((state) => ({
          pausing: { ...state.pausing, [libraryId]: false },
          libraries: patchLibrary(state.libraries, libraryId, (l) => ({ ...l, paused })),
        }));
        toast.success(paused ? "Library paused" : "Library is back online", {
          description: paused
            ? `${library.address} now shows a holding page.`
            : `${library.address} is serving the library again.`,
        });
      }, PAUSE_MS);
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
              name: l.draft.identity.name,
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
            name: l.draft.identity.name,
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
      const sections = changedSections(library);
      set((state) => ({
        activation: { ...state.activation, [libraryId]: { stageIndex: 0, rev } },
        libraries: patchLibrary(state.libraries, libraryId, (l) =>
          isDirty(l)
            ? { ...l, saved: structuredClone(l.draft), name: l.draft.identity.name }
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
                versions: [
                  {
                    rev,
                    at: dateStamp(),
                    by: "You",
                    sections,
                    status: "live" as const,
                  },
                  ...l.versions.map((v) =>
                    v.status === "live" ? { ...v, status: "previous" as const } : v,
                  ),
                ],
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
