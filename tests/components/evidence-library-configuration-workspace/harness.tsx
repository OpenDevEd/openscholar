import { act, render, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { TooltipProvider } from "@/components/ui/tooltip";
import { beforeAll, vi } from "vitest";

// Shared by the configuration workspace tests. Every test renders all fifteen
// configuration sections, so a single case can pass five seconds on a busy
// machine. The tests are spread over several files so Vitest runs them at once.
vi.setConfig({ testTimeout: 20_000 });

/** What the mocked Convex hooks answer; each test sets what it needs. */
export const harness = {
  manualDigestAvailable: false as boolean | undefined,
  // What the platform says a publish needs from the library's software.
  publishRuntimeAnswer: undefined as "current" | "update" | "unreleased" | undefined,
  /** The credential rows the page reads; a test may add the OpenRouter key. */
  storedCredentials: [] as { credentialKey: string }[],
  // One action callback per test, as Convex gives one per mounted section; the
  // Versions section caches its update check by that callback.
  checkAction: (() => undefined) as (args: unknown) => unknown,
};

const queryMock = vi.hoisted(() => vi.fn());

const mutationMock = vi.hoisted(() => vi.fn());
// The Versions section checks for software updates when the page opens.
const checkMock = vi.hoisted(() =>
  vi.fn(async () => ({
    running: "aaaaaaa1234",
    latest: "aaaaaaa1234",
    changes: [],
    checkedAt: Date.UTC(2026, 7, 26, 12, 0),
  })),
);
const pushMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return toast;
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  // Keys under the page namespace come back as-is ("identity.nameLabel").
  useTranslations: (namespace: string) => (key: string) => {
    const full = `${namespace}.${key}`;
    const prefix = "evidenceLibraryConfiguration.";
    return full.startsWith(prefix) ? full.slice(prefix.length) : full;
  },
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString() }),
  useNow: () => new Date("2026-09-27T12:10:00.000Z"),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

// The Team section opens Clerk's organisation modal from its manage button.
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ openOrganizationProfile: vi.fn() }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      digests: { manual: { available: "manualDigestAvailable" }, manualActions: { send: "sendManualDigest" } },
      publicationProviders: {get: "getPublicationProviders"},
      publicationProviderActions: {verifyAndSave: "verifyPublicationProviders"},
      queries: { getDraft: "getDraft", listTeam: "listTeam" },
      team: { addOrganizationMember: "addOrganizationMember", changeRole: "changeRole", removeMember: "removeMember" },
      invitations: { change: "changeInvitation" },
      invitationActions: { invite: "inviteMember" },
      credentials: { listCredentialMetadata: "listCredentialMetadata" },
      credentialActions: { writeCredential: "writeCredential" },
      aiProviderKey: { removeAiProviderKey: "removeAiProviderKey" },
      openAlexSourceKey: { removeOpenAlexKey: "removeOpenAlexKey" },
      sourceStatus: { listForLibrary: "listSourceStatus" },
      collectionSources: {
        listLibraryCollectionSources: "listLibraryCollectionSources",
        connectCollectionSource: "connectCollectionSource",
      },
      mutations: {
        activateConfiguration: "activateConfiguration",
        saveDraftSections: "saveDraftSections",
      },
      teardown: { requestDevelopmentTeardown: "requestDevelopmentTeardown" },
      uploads: { generateUploadUrl: "generateUploadUrl" },
      uploadActions: { upload: "upload", remove: "remove" },
      updates: { check: "check", listAddressNotices: "listAddressNotices", publishRuntime: "publishRuntime" },
      addressActions: { moveLibraryAddress: "moveLibraryAddress" },
      configurationDeployment: {
        retryConfigurationDeployment: "retryConfigurationDeployment",
      },
      domains: {
        listDomains: "listDomains",
        chooseMainAddress: "chooseMainAddress",
        stageMainDomainRemoval: "stageMainDomainRemoval",
      },
      domainActions: {
        addDomain: "addDomain",
        checkDomains: "checkDomains",
        removeDomain: "removeDomain",
      },
      versions: {
        listVersions: "listVersions",
        startRuntimeUpdate: "startRuntimeUpdate",
        restoreRevision: "restoreRevision",
        setDomainPrimary: "setDomainPrimary",
      },
    },
    zotero: {
      actions: { startOAuth: "startOAuth" },
      mutations: { disconnect: "disconnect" },
      queries: { getConnectionStatus: "getConnectionStatus" },
      libraryGroups: { listLibraryZoteroGroups: "listLibraryZoteroGroups", removeZoteroGroup: "removeZoteroGroup" },
      libraryGroupActions: { listMyZoteroGroups: "listMyZoteroGroups", connectZoteroGroup: "connectZoteroGroup" },
      runtimeReadActions: {
        listLibraryCollections: "listLibraryCollections",
        listRecordInstitutions: "listRecordInstitutions",
        resolveLibraryCollections: "resolveLibraryCollections",
        listReviewedPublications: "listReviewedPublications",
        readHomeQuestions: "readHomeQuestions",
        requestSourceRun: "requestSourceRun",
      },
    },
    library: { collections: { getCollectionsWithCounts: "getCollectionsWithCounts" } },
    models: {
      queries: {
        listCatalogOptions: "listCatalogOptions",
        paginateCatalogOptions: "paginateCatalogOptions",
      },
    },
  },
}));


// The page asks the library to name the collections it shows.
const resolveCollectionsMock = vi.hoisted(() => vi.fn(async () => ({ items: [] })));
// The Home card asks the library for its own questions and reviewed publications.
const homeQuestionsMock = vi.hoisted(() =>
  vi.fn(async () => ({ questions: ["What does the evidence say about literacy?", null, null] })),
);
const reviewedPublicationsMock = vi.hoisted(() => vi.fn(async () => ({ items: [], nextCursor: null })));

// OpenAlex is not asked during tests.
vi.mock("@/lib/hooks/use-history-count", () => ({
  useOpenAlexQueryCounts: () => [],
}));
vi.mock("@/components/providers/convex-provider", () => ({
  useAuthReadiness: () => ({ canRunProtectedQueries: true, phase: "ready" }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: async () => [] }),
  useMutation: (mutation: unknown) => mutationMock(mutation),
  // No library has reported source status in these cases.
  useQueries: () => ({}),
  useQuery: (query: unknown) =>
    query === "publishRuntime"
      ? harness.publishRuntimeAnswer
      : query === "listCatalogOptions"
      ? TEST_AI_MODELS.map((modelId, index) => ({
          _id: `display_model_${index}`,
          modelId,
          name: modelId,
          provider: modelId.split("/")[0],
          inputPricePerMillion: 1,
          outputPricePerMillion: 2,
        }))
      : undefined,
  usePaginatedQuery: (query: unknown) => ({
    results:
      query === "paginateCatalogOptions"
        ? [...TEST_AI_MODELS, "meta-llama/llama-4-maverick"].map((modelId, index) => ({
          _id: `model_${index}`,
          modelId,
          name: modelId,
          provider: modelId.split("/")[0],
          inputPricePerMillion: 1,
          outputPricePerMillion: 2,
        }))
        : [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
  useAction: (action: unknown) =>
    action === "check"
      ? harness.checkAction
      : action === "resolveLibraryCollections"
        ? resolveCollectionsMock
        : action === "readHomeQuestions"
          ? homeQuestionsMock
          : action === "listReviewedPublications"
            ? reviewedPublicationsMock
            : mutationMock(action),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    query === "manualDigestAvailable" ? {data: harness.manualDigestAvailable, isReady: harness.manualDigestAvailable !== undefined} : query === "getPublicationProviders" ? {data: undefined, isReady: false} : query === "getConnectionStatus"
      ? { data: { connected: false }, isReady: true }
      : query === "listLibraryZoteroGroups" ||
          query === "listLibraryCollectionSources" ||
          query === "listVersions" ||
          query === "listAddressNotices"
        ? { data: [], isReady: true }
        : query === "listCredentialMetadata"
          ? { data: harness.storedCredentials, isReady: true }
          : query === "listTeam"
            ? {
                data: { organizationName: "Test Org", owners: [], editors: [], creators: [], invitations: [], availablePeople: [] },
                isReady: true,
              }
            : query === "listDomains"
              ? {
                  data: {
                    platformAddress: savedIdentity.baseUrl,
                    canonicalAddress: savedIdentity.baseUrl,
                    mainAddress: savedIdentity.baseUrl,
                    mainNeedsAttention: false,
                    live: true,
                    domains: [],
                  },
                  isReady: true,
                }
              : queryMock(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { ConfigurationWorkspace } from "@/components/evidence-libraries/configuration/configuration-workspace";
import {
  AI_PROVIDER_CREDENTIAL_KEY,
} from "@/lib/evidence-libraries/configuration/ai";
import { TEST_AI_MODELS } from "@/lib/evidence-libraries/configuration/test-models";

export const savedIdentity = {
  name: "Saved Library",
  shortName: "saved-library",
  baseUrl: "https://saved-library.libraries.example.test",
  assets: {
    logoLight: "https://assets.example.test/logo-light.svg",
    favicon: "https://assets.example.test/favicon.svg",
  },
};
export const savedTheme = {
  layout: "small",
  defaultMode: "dark",
  colors: {
    accent: "#e68124",
    tertiary: "#2b4c7e",
    link: "#c2410c",
    backgroundDark: "#0f0f0f",
    backgroundLight: "#F4F2EE",
    cardDark: "#141414",
    cardLight: "#FFFFFF",
  },
  fonts: {
    heading: { source: "google", family: "Montserrat" },
    body: { source: "google", family: "Ubuntu" },
  },
};

export const savedRows = [
  { sectionKey: "identity", payload: savedIdentity },
  { sectionKey: "theme", payload: savedTheme },
  { sectionKey: "institutions", payload: [{ id: "inst_1", name: "EdTech Hub" }] },
  { sectionKey: "localization", payload: { locales: ["en-GB"], defaultLocale: "en-GB" } },
  { sectionKey: "navigation", payload: { links: [] } },
  { sectionKey: "features", payload: {} },
  { sectionKey: "footer", payload: {} },
  { sectionKey: "contact", payload: {} },
  { sectionKey: "email", payload: { takedownRecipient: "takedown@example.org" } },
  { sectionKey: "legal", payload: {} },
  { sectionKey: "notifications", payload: {} },
  { sectionKey: "collections", payload: [] },
  { sectionKey: "search", payload: {} },
  { sectionKey: "filters", payload: {} },
  { sectionKey: "topics", payload: {} },
  { sectionKey: "sources", payload: [] },
  { sectionKey: "content", payload: {} },
  { sectionKey: "citations", payload: {} },
  { sectionKey: "exports", payload: {} },
  { sectionKey: "analytics", payload: {} },
  { sectionKey: "ai", payload: {} },
  { sectionKey: "home", payload: {} },
];

export function draftResult(
  overrides: {
    operation?: unknown;
    state?: string;
    hasUnpublishedChanges?: boolean;
    sections?: { sectionKey: string; payload: unknown }[];
    editVersion?: number;
  } = {},
) {
  return {
    data: {
      library: {
        _id: "library_123",
        name: "Saved Library",
        state: overrides.state ?? "active",
        organizationId: "organization_123",
      },
      draft: {
        _id: "draft_123",
        libraryId: "library_123",
        editVersion: overrides.editVersion ?? 4,
      },
      operation: overrides.operation ?? null,
      hasUnpublishedChanges: overrides.hasUnpublishedChanges ?? false,
      sections: overrides.sections ?? savedRows,
    },
    isReady: true,
  };
}

/**
 * The Versions section suspends until the update check answers. React retries
 * a suspended tree only inside an awaited act, so render and settle there.
 */
// A fresh element every time: React skips a re-render when it is given the
// exact element it already rendered.
export const workspaceTree = () => (
  <NuqsTestingAdapter>
    <TooltipProvider>
      <ConfigurationWorkspace libraryId="library_123" />
    </TooltipProvider>
  </NuqsTestingAdapter>
);

/** Renders the page and returns a way to make the page re-read the draft. */
export async function renderWorkspace() {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(workspaceTree());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    unmount: () => result?.unmount(),
    // The Convex query is mocked, so a fresh read needs a render from the top.
    reread: async () => {
      await act(async () => {
        result?.rerender(workspaceTree());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

export function identityCard() {
  return within(document.getElementById("sec-identity")!);
}

// Radix Select uses Pointer Events that JSDOM does not ship.
beforeAll(() => {
  for (const name of ["hasPointerCapture", "releasePointerCapture", "setPointerCapture"] as const) {
    if (!Element.prototype[name]) {
      Element.prototype[name] = (() => false) as never;
    }
  }
});

/**
 * Enters a value in one event. The page re-renders on every keystroke, so
 * typing a long value character by character costs seconds and proves
 * nothing these tests are about.
 */
export async function fillField(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string,
) {
  await user.click(field);
  await user.paste(value);
}

/** Resets every mock and returns the saves and activations the page sends. */
export function resetWorkspace() {
  const saved: unknown[] = [];
  const activated: unknown[] = [];
  harness.storedCredentials = [];
  harness.manualDigestAvailable = false;
  harness.publishRuntimeAnswer = undefined;
  harness.checkAction = () => checkMock();
  queryMock.mockReset();
  mutationMock.mockReset();
  pushMock.mockReset();
  toastMock.mockReset();
  toastMock.error.mockReset();
  toastMock.success.mockReset();
  queryMock.mockReturnValue(draftResult());
  mutationMock.mockImplementation((reference: unknown) => {
    if (reference === "saveDraftSections") {
      return async (input: unknown) => {
        saved.push(input);
        return { editVersion: 5 };
      };
    }
    if (reference === "activateConfiguration") {
      return async (input: unknown) => {
        activated.push(input);
        return { editVersion: 6, kind: "publish", revisionKey: "r2", status: "queued" };
      };
    }
    return async () => null;
  });
  return { saved, activated };
}

/** Every save is refused, with a pointer that belongs to the Identity card. */
export function refuseNextSave() {
  mutationMock.mockImplementation((reference: unknown) => {
    if (reference === "saveDraftSections") {
      return async () => {
        throw new ConvexError({
          code: "VALIDATION_ERROR",
          message: "/identity/name: This name is already taken.",
          pointer: "/identity/name",
        });
      };
    }
    return async () => null;
  });
  return Promise.resolve();
}

// Declared with vi.hoisted above, which cannot be exported where it is declared.
export {
  checkMock,
  homeQuestionsMock,
  mutationMock,
  pushMock,
  queryMock,
  resolveCollectionsMock,
  reviewedPublicationsMock,
  toastMock,
};
