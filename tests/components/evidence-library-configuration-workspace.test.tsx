/**
 * @vitest-environment jsdom
 */
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Every test here renders all fourteen configuration sections and types into
// them one key at a time, so a single case can pass five seconds on a busy
// machine. The whole file still finishes in about thirty seconds.
vi.setConfig({ testTimeout: 20_000 });

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
}));

vi.mock("sonner", () => ({ toast: toastMock }));

// The Team section opens Clerk's organisation modal from its manage button.
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ openOrganizationProfile: vi.fn() }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: { getDraft: "getDraft", listTeam: "listTeam" },
      team: { addOrganizationMember: "addOrganizationMember", changeRole: "changeRole", removeMember: "removeMember" },
      invitations: { change: "changeInvitation" },
      invitationActions: { invite: "inviteMember" },
      credentials: { listCredentialMetadata: "listCredentialMetadata" },
      credentialActions: { writeCredential: "writeCredential" },
      aiProviderKey: { removeAiProviderKey: "removeAiProviderKey" },
      mutations: {
        activateConfiguration: "activateConfiguration",
        saveDraftSections: "saveDraftSections",
      },
      teardown: { requestDevelopmentTeardown: "requestDevelopmentTeardown" },
      uploads: { generateUploadUrl: "generateUploadUrl" },
      uploadActions: { upload: "upload", remove: "remove" },
      updates: { check: "check", listAddressNotices: "listAddressNotices" },
      addressActions: { moveLibraryAddress: "moveLibraryAddress" },
      configurationDeployment: {
        retryConfigurationDeployment: "retryConfigurationDeployment",
      },
      domains: { listDomains: "listDomains" },
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
      },
    },
    models: {
      queries: {
        listCatalogOptions: "listCatalogOptions",
        paginateCatalogOptions: "paginateCatalogOptions",
      },
    },
  },
}));

// One action callback per test, as Convex gives one per mounted section; the
// Versions section caches its update check by that callback.
let checkAction: (args: unknown) => unknown;

// The page asks the library to name the collections it shows.
const resolveCollectionsMock = vi.hoisted(() => vi.fn(async () => ({ items: [] })));

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) => mutationMock(mutation),
  useQuery: (query: unknown) =>
    query === "listCatalogOptions"
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
      ? checkAction
      : action === "resolveLibraryCollections"
        ? resolveCollectionsMock
        : mutationMock(action),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    query === "getConnectionStatus"
      ? { data: { connected: false }, isReady: true }
      : query === "listLibraryZoteroGroups" ||
          query === "listVersions" ||
          query === "listAddressNotices"
        ? { data: [], isReady: true }
        : query === "listCredentialMetadata"
          ? { data: storedCredentials, isReady: true }
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

const savedIdentity = {
  name: "Saved Library",
  shortName: "saved-library",
  baseUrl: "https://saved-library.libraries.example.test",
  assets: {
    logoDark: "https://assets.example.test/logo-dark.svg",
    favicon: "https://assets.example.test/favicon.svg",
  },
};
const savedTheme = {
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
/** The credential rows the page reads; a test may add the OpenRouter key. */
let storedCredentials: { credentialKey: string }[] = [];

const savedRows = [
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
  { sectionKey: "sources", payload: [] },
  { sectionKey: "content", payload: {} },
  { sectionKey: "citations", payload: {} },
  { sectionKey: "exports", payload: {} },
  { sectionKey: "analytics", payload: {} },
  { sectionKey: "ai", payload: {} },
];

function draftResult(
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
const workspaceTree = () => (
  <NuqsTestingAdapter>
    <TooltipProvider>
      <ConfigurationWorkspace libraryId="library_123" />
    </TooltipProvider>
  </NuqsTestingAdapter>
);

/** Renders the page and returns a way to make the page re-read the draft. */
async function renderWorkspace() {
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

function identityCard() {
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
async function fillField(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string,
) {
  await user.click(field);
  await user.paste(value);
}

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    saved = [];
    activated = [];
    storedCredentials = [];
    checkAction = () => checkMock();
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
  });

  it("shows the admin link only while an active library is idle", async () => {
    const { unmount } = await renderWorkspace();
    expect(
      screen.getByRole("link", { name: "evidenceLibraries.list.openAdmin" }),
    ).toHaveAttribute("href", "/evidence-libraries/library_123/admin");

    unmount();
    queryMock.mockReturnValue(draftResult({ state: "provisioning" }));
    const draftWorkspace = await renderWorkspace();
    expect(
      screen.queryByRole("link", { name: "evidenceLibraries.list.openAdmin" }),
    ).toBeNull();

    draftWorkspace.unmount();
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_123",
          kind: "configuration",
          status: "running",
          stage: "deployment",
          updatedAt: 1,
        },
      }),
    );
    await renderWorkspace();
    expect(
      screen.queryByRole("link", { name: "evidenceLibraries.list.openAdmin" }),
    ).toBeNull();
  });

  it("puts Domain in the rail beside Versions, with its own card", async () => {
    await renderWorkspace();
    const rail = within(
      screen.getByRole("navigation", { name: "rail.aria" }),
    );
    const domain = rail.getByRole("link", { name: /sections\.domain/ });
    expect(domain).toHaveAttribute("href", "#sec-domain");
    // Domain is not a configuration section, so it carries no saved-state dot.
    expect(within(domain).queryByRole("img")).toBeNull();
    expect(document.getElementById("sec-domain")).toBeInTheDocument();
  });

  it("saves only the sections that changed", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    expect(queryMock).toHaveBeenCalledWith("getDraft", { libraryId: "library_123" });

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "Renamed Library");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(saved).toEqual([
        {
          libraryId: "library_123",
          expectedEditVersion: 4,
          sections: [
            {
              sectionKey: "identity",
              payload: { ...savedIdentity, name: "Renamed Library" },
            },
          ],
        },
      ]),
    );
    expect(toastMock.success).toHaveBeenCalledWith("saved");
  });

  it("writes the navigation bar choice to theme.layout", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("radio", { name: /theme\.layout\.wide/ }));
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
    expect(request.sections.map((row) => row.sectionKey)).toEqual(["theme"]);
    expect(request.sections[0]?.payload).toEqual({ ...savedTheme, layout: "wide" });
  });

  it("shows Needs attention for a section with a problem and blocks Activate and Save", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();

    await user.clear(identityCard().getByLabelText("identity.nameLabel"));

    expect(identityCard().getByText("sectionState.attention")).toBeInTheDocument();
    expect(identityCard().getByRole("alert")).toHaveTextContent("identity.nameError");
    expect(screen.getByRole("img", { name: "sectionState.attention" })).toHaveAttribute(
      "data-state",
      "attention",
    );
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "save" }));
    expect(saved).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledWith("fixFirstToast", expect.anything());
  });

  it("enables Activate only for a saved or local change", async () => {
    const user = userEvent.setup();
    const { unmount } = await renderWorkspace();
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();

    await user.clear(identityCard().getByLabelText("identity.nameLabel"));
    await fillField(
      user,
      identityCard().getByLabelText("identity.nameLabel"),
      "Renamed Library",
    );
    expect(screen.getByRole("button", { name: "activate" })).toBeEnabled();

    unmount();
    queryMock.mockReturnValue(draftResult({ hasUnpublishedChanges: true }));
    await renderWorkspace();
    expect(screen.getByRole("button", { name: "activate" })).toBeEnabled();
  });

  /** Every save is refused, with a pointer that belongs to the Identity card. */
  function refuseNextSave() {
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

  it("shows a refused save inside the section that owns the value", async () => {
    const user = userEvent.setup();
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
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));

    const refusal = await waitFor(() => identityCard().getByRole("alert"));
    expect(refusal).toHaveTextContent("saveRefused");
    expect(refusal).toHaveTextContent("This name is already taken.");
    expect(refusal).not.toHaveTextContent("/identity/name");
    expect(toastMock.error).toHaveBeenCalledWith("This name is already taken.");
  });

  it("clears a refused save once the next save works", async () => {
    const user = userEvent.setup();
    let refuse = true;
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async (input: unknown) => {
          if (refuse) {
            throw new ConvexError({
              code: "VALIDATION_ERROR",
              message: "/identity/name: This name is already taken.",
              pointer: "/identity/name",
            });
          }
          saved.push(input);
          return { editVersion: 5 };
        };
      }
      return async () => null;
    });
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    refuse = false;
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a refused activation on screen after the save that came first", async () => {
    const user = userEvent.setup();
    // Activate saves first. That save raises the edit version, which restarts
    // the form from the newer rows. The refusal that follows must survive it.
    let editVersion = 4;
    let releaseActivate = () => {};
    const activateReached = new Promise<void>((resolve) => {
      releaseActivate = resolve;
    });
    queryMock.mockImplementation(() => draftResult({ editVersion }));
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async (input: unknown) => {
          saved.push(input);
          editVersion = 5;
          return { editVersion: 5 };
        };
      }
      if (reference === "activateConfiguration") {
        return async () => {
          await activateReached;
          throw new ConvexError({
            code: "VALIDATION_ERROR",
            message: "/identity/name: This name is already taken.",
            pointer: "/identity/name",
          });
        };
      }
      return async () => null;
    });
    const { reread } = await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "activate" }));
    await user.click(screen.getByRole("button", { name: "activateConfirm" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    // The platform now has the newer draft, so the form starts again.
    await reread();
    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue(
      "Saved Library",
    );

    releaseActivate();
    const refusal = await waitFor(() => identityCard().getByRole("alert"));
    expect(refusal).toHaveTextContent("saveRefused");
    expect(refusal).toHaveTextContent("This name is already taken.");
  });

  it("shows a refusal that belongs to no card above the sections", async () => {
    const user = userEvent.setup();
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async () => {
          throw new ConvexError({
            code: "VALIDATION_ERROR",
            message: "The library was changed somewhere else. Reload the page.",
          });
        };
      }
      return async () => null;
    });
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));

    const refusal = await waitFor(() => screen.getByRole("alert"));
    expect(refusal).toHaveTextContent("saveRefusedAll");
    expect(refusal).toHaveTextContent(
      "The library was changed somewhere else. Reload the page.",
    );
    expect(document.getElementById("sec-identity")).not.toContainElement(refusal);
  });

  it("clears a refused save when the owner opens another section", async () => {
    const user = userEvent.setup();
    await refuseNextSave();
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.click(screen.getByRole("link", { name: /sections\.theme/ }));

    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a refused save when the owner uses Back to top", async () => {
    const user = userEvent.setup();
    await refuseNextSave();
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.click(screen.getByRole("button", { name: "backToTop" }));

    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a refused save when the owner edits or resets the card", async () => {
    const user = userEvent.setup();
    await refuseNextSave();
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.type(identityCard().getByLabelText("identity.nameLabel"), "!");
    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.click(identityCard().getByRole("button", { name: "fields.reset" }));
    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets a section back to the saved values", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "Renamed Library");
    expect(identityCard().getByText("sectionState.edited")).toBeInTheDocument();

    await user.click(identityCard().getByRole("button", { name: "fields.reset" }));

    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("Saved Library");
    expect(identityCard().getByText("sectionState.complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });

  it("keeps the short name and public address read-only", async () => {
    await renderWorkspace();
    const shortName = identityCard().getByRole("textbox", { name: "identity.shortNameLabel" });
    const address = identityCard().getByRole("textbox", { name: "identity.addressLabel" });
    expect(shortName).toHaveAttribute("aria-readonly", "true");
    expect(shortName).toHaveTextContent("saved-library");
    expect(address).toHaveAttribute("aria-readonly", "true");
    expect(address).toHaveTextContent(savedIdentity.baseUrl);
  });

  it("saves unsaved changes first, then activates with the new edit version", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "Renamed Library");

    await user.click(screen.getByRole("button", { name: "activate" }));
    await user.click(screen.getByRole("button", { name: "activateConfirm" }));

    await waitFor(() =>
      expect(activated).toEqual([{ libraryId: "library_123", expectedEditVersion: 5 }]),
    );
    expect(saved).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("sends a new library to the setup page after activation", async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(draftResult({ state: "provisioning" }));
    mutationMock.mockImplementation((reference: unknown) =>
      reference === "activateConfiguration"
        ? async () => ({ editVersion: 5, kind: "setup", revisionKey: "r1", status: "queued" })
        : async () => ({ editVersion: 5 }),
    );
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "setUpAndActivate" }));
    await user.click(screen.getByRole("button", { name: "activateDraftConfirm" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/evidence-libraries/library_123/setup"),
    );
  });

  it("lists assembly issues from the failed operation with a link to the section", async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_1",
          kind: "publish",
          status: "failed",
          stage: "assembling",
          retryable: false,
          error: { code: "VALIDATION_ERROR", message: "The configuration is not valid", stage: "assembling" },
          issues: [
            { pointer: "/theme/colors/accent", message: "Value must match the pattern." },
            { pointer: "/identity/name", message: "Value must match the pattern." },
            { pointer: "/localization/locales", message: "Choose at least one language." },
          ],
        },
      }),
    );
    await renderWorkspace();

    const notice = screen.getByText("operationFailed").closest("[data-operation-issues]")!;
    expect(notice).toHaveTextContent("The configuration is not valid");
    expect(within(notice as HTMLElement).getByText("/localization/locales")).toBeInTheDocument();
    expect(notice).toHaveTextContent("Choose at least one language.");
    expect(
      within(notice as HTMLElement).getAllByText("Value must match the pattern."),
    ).toHaveLength(2);
    const link = within(notice as HTMLElement).getByRole("link", { name: "/theme/colors/accent" });
    expect(link).toHaveAttribute("href", "#sec-theme");
    await user.click(link);
    expect(screen.getByRole("link", { name: /sections\.theme/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("does not show Retry for a failed operation the server marked non-retryable", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_old",
          kind: "publish",
          status: "failed",
          stage: "publishing",
          retryable: false,
          error: {
            code: "CONFIGURATION_DEPLOYMENT_STALLED",
            message: "The publish stopped answering. Try again.",
            stage: "publishing",
          },
        },
      }),
    );
    await renderWorkspace();

    const notice = screen
      .getByText("operationFailed")
      .closest("[data-operation-issues]")!;
    expect(
      within(notice as HTMLElement).queryByRole("button", { name: "retry" }),
    ).toBeNull();
  });

  it("does not name the hosting provider in a failed activation", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_hosting",
          kind: "publish",
          status: "failed",
          stage: "deployment",
          retryable: true,
          error: {
            code: "INVALID_COOLIFY_CONFIG",
            message: "EL_COOLIFY_URL is not configured",
            stage: "deployment",
          },
        },
      }),
    );
    await renderWorkspace();

    const notice = screen
      .getByText("operationFailed")
      .closest("[data-operation-issues]")!;
    expect(notice).toHaveTextContent("activationError");
    expect(notice).not.toHaveTextContent(/Coolify/i);
  });

  it("shows Retry for a failed operation the server marked retryable", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_current",
          kind: "publish",
          status: "failed",
          stage: "publishing",
          retryable: true,
          error: {
            code: "CONFIGURATION_DEPLOYMENT_STALLED",
            message: "The publish stopped answering. Try again.",
            stage: "publishing",
          },
        },
      }),
    );
    await renderWorkspace();

    const notice = screen
      .getByText("operationFailed")
      .closest("[data-operation-issues]")!;
    expect(
      within(notice as HTMLElement).getByRole("button", { name: "retry" }),
    ).toBeInTheDocument();
  });

  it("lets a new library be set up while its setup operation waits for the owner", async () => {
    queryMock.mockReturnValue(
      draftResult({
        state: "provisioning",
        operation: { _id: "operation_1", kind: "setup", status: "queued", stage: "queued" },
      }),
    );
    await renderWorkspace();
    expect(document.querySelector("[data-operation-stage]")).toBeNull();
    expect(screen.getByRole("button", { name: "setUpAndActivate" })).toBeEnabled();
  });

  it("shows the running stage and blocks Activate while an operation runs", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: { _id: "operation_1", kind: "publish", status: "running", stage: "deployment" },
      }),
    );
    await renderWorkspace();
    const activate = screen.getByRole("button", {
      name: /applying · stages\.deployment/,
    });
    expect(activate).toBeDisabled();
    expect(within(activate).getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "applying · stages.deployment" }),
    ).toHaveAttribute("data-operation-stage", "deployment");
  });

  it("names the software update while it runs and blocks Activate", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_123",
          kind: "publish",
          status: "running",
          stage: "deployment",
          revisionId: "revision_123",
          runtimeUpdate: { from: "aaaaaaa1234", to: "bbbbbbb1234" },
        },
      }),
    );
    await renderWorkspace();
    const activate = screen.getByRole("button", {
      name: /updatingSoftware · stages\.deployment/,
    });
    expect(activate).toBeDisabled();
    expect(within(activate).getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "updatingSoftware · stages.deployment",
      }),
    ).toHaveAttribute("data-operation-stage", "deployment");
    expect(screen.getByRole("link", { name: "sections.versions" })).toHaveAttribute(
      "href",
      "#sec-versions",
    );
  });

  it("requires the exact library name before queuing development teardown", async () => {
    const user = userEvent.setup();
    const teardowns: unknown[] = [];
    mutationMock.mockImplementation((reference: unknown) =>
      reference === "requestDevelopmentTeardown"
        ? async (input: unknown) => {
            teardowns.push(input);
            return { operationId: "operation_123", status: "queued" };
          }
        : async () => ({}),
    );
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "danger.deleteButton" }));
    const confirm = screen.getByRole("button", { name: "deleteDialog.confirm" });
    expect(confirm).toBeDisabled();
    await fillField(user, screen.getByLabelText("deleteDialog.typeToConfirm"), "Saved Library");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(teardowns).toEqual([{ libraryId: "library_123", confirmationName: "Saved Library" }]),
    );
    expect(pushMock).toHaveBeenCalledWith("/evidence-libraries");
  });

  describe("content sections", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
      await user.click(trigger);
      await user.click(await screen.findByRole("option", { name: option }));
    }

    it("writes the top bar search switch to the features row", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      await user.click(card("navigation").getByRole("switch", { name: "navigation.showSearch" }));
      expect(card("navigation").getByText("sectionState.edited")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections.map((row) => row.sectionKey)).toEqual(["features"]);
      expect(request.sections[0]?.payload).toMatchObject({
        navbarSearch: false,
        collections: true,
        downloads: false,
      });
    });

    it("asks for an address once a link goes to an external site", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const navigation = card("navigation");
      await user.click(navigation.getByRole("button", { name: "navigation.addLink" }));
      const row = within(document.querySelector("[data-nav-link]") as HTMLElement);
      expect(row.getByRole("alert")).toHaveTextContent("links.labelError");
      await fillField(user, row.getByLabelText("links.labelLabel"), "About");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      await fillField(user, row.getByLabelText("links.urlLabel"), "https://example.org/about");
      expect(row.getByRole("switch", { name: "links.newTab" })).toBeInTheDocument();
      expect(navigation.getByText("sectionState.edited")).toBeInTheDocument();
    });

    it("clears the other target when a link changes what it goes to", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const navigation = card("navigation");
      await user.click(navigation.getByRole("button", { name: "navigation.addLink" }));
      const row = within(document.querySelector("[data-nav-link]") as HTMLElement);
      await fillField(user, row.getByLabelText("links.labelLabel"), "About");
      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      await fillField(user, row.getByLabelText("links.urlLabel"), "https://example.org/about");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.page");
      expect(row.queryByLabelText("links.urlLabel")).not.toBeInTheDocument();
      expect(row.queryByRole("switch", { name: "links.newTab" })).not.toBeInTheDocument();
      expect(row.getByRole("combobox", { name: "links.pageLabel" })).toHaveTextContent("links.pages.home");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      expect(row.getByLabelText("links.urlLabel")).toHaveValue("");
      expect(row.getByRole("alert")).toHaveTextContent("links.urlError");
      expect(navigation.getByText("sectionState.attention")).toBeInTheDocument();
    });

    it("keeps the OpenScholar credit switched on", async () => {
      await renderWorkspace();
      const credit = card("footer").getByRole("switch", { name: "footer.poweredBy" });
      expect(credit).toBeChecked();
      expect(credit).toBeDisabled();
    });

    it("shows a recipient field only while its switch is on and saves nothing when off", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const contact = card("contact");
      const contactForm = contact.getByRole("switch", { name: "contact.contactRecipientLabel" });
      const takedown = contact.getByRole("switch", { name: "contact.takedownRecipientLabel" });
      expect(contactForm).not.toBeChecked();
      expect(contact.queryByLabelText("contact.contactRecipient")).not.toBeInTheDocument();
      expect(takedown).toBeChecked();
      expect(contact.getByLabelText("contact.takedownRecipient")).toHaveValue("takedown@example.org");

      await user.click(contactForm);
      expect(contact.getByText("sectionState.attention")).toBeInTheDocument();
      await fillField(user, contact.getByLabelText("contact.contactRecipient"), "team@example.org");
      expect(contact.getByText("sectionState.edited")).toBeInTheDocument();

      await user.click(takedown);
      expect(contact.queryByLabelText("contact.takedownRecipient")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        { sectionKey: "email", payload: { contactRecipient: "team@example.org" } },
      ]);
    });

    it("switches a legal page between an address and uploaded text, then saves the text", async () => {
      const user = userEvent.setup();
      mutationMock.mockImplementation((reference: unknown) => {
        if (reference === "saveDraftSections") {
          return async (input: unknown) => {
            saved.push(input);
            return { editVersion: 5 };
          };
        }
        if (reference === "generateUploadUrl") return async () => "https://upload.example.test/put";
        if (reference === "upload") {
          return async () => ({ kind: "text", bytes: 20, name: "privacy.md", text: "# Privacy\n\nWe keep little." });
        }
        return async () => null;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 })),
      );
      try {
        await renderWorkspace();
        const privacy = document.querySelector("[data-legal='privacy']") as HTMLElement;
        expect(privacy).toHaveAttribute("data-legal-kind", "none");

        await user.click(within(privacy).getByRole("tab", { name: "contact.legalKinds.url" }));
        expect(privacy).toHaveAttribute("data-legal-kind", "url");
        await fillField(user, within(privacy).getByLabelText("contact.legalUrl"), "https://example.org/privacy");

        await user.click(within(privacy).getByRole("tab", { name: "contact.legalKinds.text" }));
        expect(privacy).toHaveAttribute("data-legal-kind", "text");
        expect(within(privacy).queryByLabelText("contact.legalUrl")).not.toBeInTheDocument();
        expect(within(privacy).getByRole("alert")).toHaveTextContent("fields.required");

        await user.upload(
          within(privacy).getByLabelText("contact.legalFile"),
          new File(["# Privacy"], "privacy.md", { type: "text/markdown" }),
        );
        await within(privacy).findByText("Privacy");
        expect(within(privacy).getByRole("button", { name: "fields.view" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "save" }));
        await waitFor(() => expect(saved).toHaveLength(1));
        const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
        expect(request.sections).toEqual([
          { sectionKey: "legal", payload: { privacyMarkdown: "# Privacy\n\nWe keep little." } },
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("discovery sections", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("drops the full-text scope when full-text search is turned off and saves the search row", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const search = card("search");
      const documents = search.getByRole("checkbox", { name: "search.scope.documents" });
      expect(documents).toBeChecked();
      await user.click(search.getByRole("switch", { name: "search.fullText" }));
      expect(documents).toBeDisabled();
      expect(documents).not.toBeChecked();
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections.map((row) => row.sectionKey)).toEqual(["search"]);
      expect(request.sections[0]?.payload).toMatchObject({ fullText: false });
      expect((request.sections[0]?.payload as { scopes: string[] }).scopes).not.toContain("documents");
    });

    it("asks for a pinned institution only in the featured mode", async () => {
      const user = userEvent.setup();
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "listRecordInstitutions"
          ? async () => ({ reason: "not-set-up", items: [] })
          : async () => null,
      );
      await renderWorkspace();
      const search = card("search");
      expect(search.queryByRole("combobox", { name: "search.featuredInstitution" })).not.toBeInTheDocument();
      await user.click(search.getByRole("combobox", { name: "search.institutionMode" }));
      await user.click(await screen.findByRole("option", { name: "search.institutionModes.facet-with-featured-value" }));
      expect(search.getByText("sectionState.attention")).toBeInTheDocument();
      expect(search.getByRole("alert")).toHaveTextContent("search.featuredInstitutionError");
      await user.click(search.getByRole("combobox", { name: "search.featuredInstitution" }));
      expect(await screen.findByText("evidenceLibraryInstitutions.picker.notSetUp")).toBeInTheDocument();
    });

    it("shows the Zotero sources and the collections picker inside their cards", async () => {
      await renderWorkspace();
      expect(card("sources").getByRole("button", { name: "sources.connect" })).toBeInTheDocument();
      expect(await card("collections").findByRole("button", { name: "collections.picker.open" })).toBeInTheDocument();
      expect(card("institutions").getByRole("combobox", { name: "institutions.nameLabel" })).toBeInTheDocument();
    });
  });

  describe("platform sections", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("disables a feature with the reason and switches it off again when its export goes", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const features = card("features");
      const downloads = features.getByRole("switch", { name: "features.labels.downloads" });
      const ris = card("citations").getByRole("switch", { name: "citations.formats.ris" });
      const bibtex = card("citations").getByRole("switch", { name: "citations.formats.bibtex" });
      expect(downloads).toBeEnabled();
      await user.click(downloads);
      expect(downloads).toBeChecked();

      await user.click(ris);
      await user.click(bibtex);
      expect(downloads).toBeDisabled();
      expect(downloads).not.toBeChecked();
      expect(features.getByText("features.needsExports")).toBeInTheDocument();
      expect(features.getByText("sectionState.complete")).toBeInTheDocument();
    });

    it("saves the Atom feed switch and unlocks the Atom feed link", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const atomLink = card("features").getByRole("switch", { name: "features.labels.atomFeed" });
      expect(atomLink).toBeDisabled();
      await user.click(card("citations").getByRole("switch", { name: "citations.formats.atom" }));
      expect(atomLink).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        { sectionKey: "exports", payload: { ris: true, bibtex: true, atom: true } },
      ]);
    });

    it("keeps the language switch off until two languages are offered", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const languageSwitch = card("features").getByRole("switch", { name: "features.labels.languageSwitcher" });
      expect(languageSwitch).toBeDisabled();
      await user.click(card("languages").getByRole("checkbox", { name: "languages.names.fr" }));
      expect(languageSwitch).toBeEnabled();
      expect(card("languages").getByText("sectionState.edited")).toBeInTheDocument();
    });

    it("asks for a measurement id as soon as Google Analytics is switched on", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const analytics = card("analytics");
      expect(analytics.queryByLabelText("analytics.measurementIdLabel")).not.toBeInTheDocument();
      await user.click(analytics.getByRole("switch", { name: "analytics.googleLabel" }));
      expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
      await user.type(analytics.getByLabelText("analytics.measurementIdLabel"), "g-abcd12");
      expect(analytics.getByText("sectionState.edited")).toBeInTheDocument();
    });

    it("saves PostHog and Google Analytics switched on together", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const analytics = card("analytics");
      // Pasted rather than typed: the page re-renders on every keystroke, and
      // what this test is about is what Save sends, not per-character state.
      const fill = async (label: string, value: string) => {
        await user.click(analytics.getByLabelText(label));
        await user.paste(value);
      };
      await user.click(analytics.getByRole("switch", { name: "analytics.googleLabel" }));
      await fill("analytics.measurementIdLabel", "g-abcd12");
      await user.click(analytics.getByRole("switch", { name: "analytics.posthogLabel" }));
      expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
      await fill("analytics.hostLabel", "https://eu.i.posthog.com");
      await fill("analytics.keyLabel", "phc_12345678901234567890");
      expect(analytics.getByText("sectionState.edited")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        {
          sectionKey: "analytics",
          payload: {
            posthog: { host: "https://eu.i.posthog.com", key: "phc_12345678901234567890" },
            google: { measurementId: "G-ABCD12" },
          },
        },
      ]);
    });
  });

  describe("the analytics fields the runtime gained", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it(
      "offers the session recordings address only once a host is set",
      async () => {
        const user = userEvent.setup();
        await renderWorkspace();
        const analytics = card("analytics");
        expect(analytics.queryByLabelText("analytics.uiHostLabel")).not.toBeInTheDocument();

        // Switched on with no host yet: the card needs attention and the
        // recordings address is still nowhere to be seen.
        await user.click(analytics.getByRole("switch", { name: "analytics.posthogLabel" }));
        expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
        expect(analytics.getByText("problems.posthog")).toBeInTheDocument();
        expect(analytics.queryByLabelText("analytics.uiHostLabel")).not.toBeInTheDocument();

        await user.type(analytics.getByLabelText("analytics.hostLabel"), "https://eu.i.posthog.com");
        await user.type(analytics.getByLabelText("analytics.keyLabel"), "phc_12345678901234567890");
        await user.type(analytics.getByLabelText("analytics.uiHostLabel"), "not-an-address");
        expect(analytics.getByText("problems.posthogUiHost")).toBeInTheDocument();
        expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();

        // Clearing the host takes the recordings address with it, so the two
        // can never be saved half-set.
        await user.clear(analytics.getByLabelText("analytics.hostLabel"));
        expect(analytics.queryByLabelText("analytics.uiHostLabel")).not.toBeInTheDocument();
        expect(analytics.queryByText("problems.posthogUiHost")).not.toBeInTheDocument();
        await user.type(analytics.getByLabelText("analytics.hostLabel"), "https://eu.i.posthog.com");
        expect(analytics.getByLabelText("analytics.uiHostLabel")).toHaveValue("");
      },
    );

    it(
      "saves a raised consent version and refuses one below one",
      async () => {
        const user = userEvent.setup();
        await renderWorkspace();
        const analytics = card("analytics");
        const version = analytics.getByLabelText("analytics.consentVersionLabel");
        await user.clear(version);
        await user.type(version, "0");
        expect(analytics.getByText("problems.consentVersion")).toBeInTheDocument();
        await user.clear(version);
        await user.type(version, "3");
        await user.click(screen.getByRole("button", { name: "save" }));
        await waitFor(() => expect(saved).toHaveLength(1));
        const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
        expect(request.sections).toEqual([
          { sectionKey: "analytics", payload: { consentPolicyVersion: 3 } },
        ]);
      },
    );
  });

  describe("the AI card", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("sits under Discovery in the rail with its state", async () => {
      await renderWorkspace();
      const discovery = within(
        screen.getByRole("navigation", { name: "rail.aria" }),
      );
      const link = discovery.getByRole("link", { name: /sections\.ai/ });
      expect(link).toHaveAttribute("href", "#sec-ai");
      expect(within(link).getByRole("img")).toHaveAccessibleName(
        "sectionState.complete",
      );
      expect(card("ai").getByRole("switch", { name: "ai.answersLabel" })).toBeInTheDocument();
    });

    it(
      "asks for a key and a model, then saves one provider entry",
      async () => {
        const user = userEvent.setup();
        const keysWritten: unknown[] = [];
        mutationMock.mockImplementation((reference: unknown) => {
          if (reference === "saveDraftSections") {
            return async (input: unknown) => {
              saved.push(input);
              return { editVersion: 5 };
            };
          }
          if (reference === "writeCredential") {
            return async (input: unknown) => {
              keysWritten.push(input);
              storedCredentials = [
                { credentialKey: AI_PROVIDER_CREDENTIAL_KEY },
              ];
              return "credential_1";
            };
          }
          return async () => null;
        });
        await renderWorkspace();
        const ai = card("ai");
        await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
        expect(ai.getByText("sectionState.attention")).toBeInTheDocument();
        expect(ai.getByText("problems.aiKey")).toBeInTheDocument();
        expect(ai.getByText("problems.aiModel")).toBeInTheDocument();

        await user.type(ai.getByLabelText("ai.keyLabel"), "sk-or-v1-test");
        await user.click(ai.getByRole("button", { name: "ai.keySave" }));
        await waitFor(() =>
          expect(keysWritten).toEqual([
            {
              libraryId: "library_123",
              concretePath: "/ai/providers/0/apiKey",
              instanceKey: "openrouter",
              value: "sk-or-v1-test",
            },
          ]),
        );

        const syncedModel = "meta-llama/llama-4-maverick";
        await user.click(ai.getByRole("button", { name: "ai.addModel" }));
        await user.click(
          await screen.findByRole("option", { name: new RegExp(syncedModel) }),
        );
        await user.click(ai.getByRole("button", { name: "ai.addModel" }));
        await user.click(
          await screen.findByRole("option", {
            name: new RegExp(TEST_AI_MODELS[1]!),
          }),
        );
        await user.click(ai.getByRole("combobox", { name: "ai.modelLabel" }));
        await user.click(
          await screen.findByRole("option", { name: TEST_AI_MODELS[1] }),
        );
        await user.click(screen.getByRole("button", { name: "save" }));

        await waitFor(() => expect(saved).toHaveLength(1));
        const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
        expect(request.sections.find((row) => row.sectionKey === "ai")).toEqual(
          {
            sectionKey: "ai",
            payload: {
              providers: [
                {
                  provider: "openrouter",
                  enabled: true,
                  models: [syncedModel, TEST_AI_MODELS[1]],
                  defaultModel: TEST_AI_MODELS[1],
                },
              ],
            },
          },
        );
        expect(request.sections.find((row) => row.sectionKey === "features")?.payload)
          .toMatchObject({ ai: true });
      },
    );

    it(
      "shows a stored key as saved and lets the owner remove it",
      async () => {
        const user = userEvent.setup();
        storedCredentials = [{ credentialKey: AI_PROVIDER_CREDENTIAL_KEY }];
        const removed: unknown[] = [];
        mutationMock.mockImplementation((reference: unknown) =>
          reference === "removeAiProviderKey"
            ? async (input: unknown) => {
                removed.push(input);
                storedCredentials = [];
                return null;
              }
            : async () => null,
        );
        await renderWorkspace();
        const ai = card("ai");
        await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
        expect(ai.getByText("ai.keyStored")).toBeInTheDocument();
        expect(ai.queryByText("problems.aiKey")).not.toBeInTheDocument();

        await user.click(ai.getByRole("button", { name: "ai.keyRemove" }));
        await waitFor(() =>
          expect(removed).toEqual([{ libraryId: "library_123" }]),
        );
        // Convex answers the removal with an empty credential list. That is
        // what puts the key field back and the card into needs attention.
        cleanup();
        queryMock.mockReturnValue(
          draftResult({
            sections: savedRows.map((row) =>
              row.sectionKey === "features"
                ? { sectionKey: "features", payload: { ai: true } }
                : row,
            ),
          }),
        );
        await renderWorkspace();
        const afterRemoval = card("ai");
        expect(afterRemoval.getByText("sectionState.attention")).toBeInTheDocument();
        expect(afterRemoval.getByText("problems.aiKey")).toBeInTheDocument();
        expect(afterRemoval.getByLabelText("ai.keyLabel")).toBeInTheDocument();
      },
    );
  });

  describe("the AI card while a key request is in flight", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("locks every key control until the save answers", async () => {
      const user = userEvent.setup();
      let release!: (id: string) => void;
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "writeCredential"
          ? () =>
              new Promise<string>((resolve) => {
                release = resolve;
              })
          : async () => null,
      );
      await renderWorkspace();
      const ai = card("ai");
      await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
      await user.type(ai.getByLabelText("ai.keyLabel"), "sk-or-v1-pending");
      await user.click(ai.getByRole("button", { name: "ai.keySave" }));

      // While the platform is still answering, nothing about the key moves.
      const save = ai.getByRole("button", { name: "ai.keySave" });
      expect(ai.getByLabelText("ai.keyLabel")).toBeDisabled();
      expect(save).toBeDisabled();
      expect(save).toHaveAttribute("aria-busy", "true");

      await act(async () => {
        release("credential_1");
      });
      // The saved key is cleared from the box, so Save has nothing to send.
      expect(save).not.toHaveAttribute("aria-busy");
      expect(ai.getByLabelText("ai.keyLabel")).toBeEnabled();
      expect(ai.getByLabelText("ai.keyLabel")).toHaveValue("");
    });

    it("locks every key control until the removal answers", async () => {
      const user = userEvent.setup();
      storedCredentials = [{ credentialKey: AI_PROVIDER_CREDENTIAL_KEY }];
      let release!: () => void;
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "removeAiProviderKey"
          ? () =>
              new Promise<null>((resolve) => {
                release = () => resolve(null);
              })
          : async () => null,
      );
      await renderWorkspace();
      const ai = card("ai");
      await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
      await user.click(ai.getByRole("button", { name: "ai.keyRemove" }));

      const removeButton = ai.getByRole("button", { name: "ai.keyRemove" });
      const replace = ai.getByRole("button", { name: "ai.keyReplace" });
      expect(removeButton).toBeDisabled();
      expect(removeButton).toHaveAttribute("aria-busy", "true");
      // Replace would start a second request against the same row.
      expect(replace).toBeDisabled();

      await act(async () => {
        release();
      });
      expect(ai.getByRole("button", { name: "ai.keyReplace" })).toBeEnabled();
    });

    it("locks Cancel while a replacement is being saved", async () => {
      const user = userEvent.setup();
      storedCredentials = [{ credentialKey: AI_PROVIDER_CREDENTIAL_KEY }];
      let release!: (id: string) => void;
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "writeCredential"
          ? () =>
              new Promise<string>((resolve) => {
                release = resolve;
              })
          : async () => null,
      );
      await renderWorkspace();
      const ai = card("ai");
      await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
      await user.click(ai.getByRole("button", { name: "ai.keyReplace" }));
      await user.type(ai.getByLabelText("ai.keyLabel"), "sk-or-v1-replacement");
      await user.click(ai.getByRole("button", { name: "ai.keySave" }));

      expect(ai.getByRole("button", { name: "ai.keyCancel" })).toBeDisabled();

      await act(async () => {
        release("credential_2");
      });
    });
  });

  describe("the AI card without a stored key", () => {
    it("needs attention while AI answers are on and no key is stored", async () => {
      queryMock.mockReturnValue(
        draftResult({
          sections: savedRows.map((row) =>
            row.sectionKey === "features"
              ? { sectionKey: "features", payload: { ai: true } }
              : row,
          ),
        }),
      );
      await renderWorkspace();
      const ai = within(document.getElementById("sec-ai")!);
      expect(ai.getByText("sectionState.attention")).toBeInTheDocument();
      expect(ai.getByText("problems.aiKey")).toBeInTheDocument();
      expect(ai.getByLabelText("ai.keyLabel")).toBeInTheDocument();
    });
  });

  describe("replaced files", () => {
    const newLogo = "https://assets.example.test/logo-dark-2.png";
    let removed: unknown[];

    beforeEach(() => {
      removed = [];
      mutationMock.mockImplementation((reference: unknown) => {
        if (reference === "saveDraftSections") {
          return async (input: unknown) => {
            saved.push(input);
            return { editVersion: 5 };
          };
        }
        if (reference === "generateUploadUrl") return async () => "https://upload.example.test/put";
        if (reference === "upload") {
          return async () => ({ kind: "file", bytes: 3, contentType: "image/png", name: "logo.png", url: newLogo });
        }
        if (reference === "remove") {
          return async (input: unknown) => {
            removed.push(input);
            return null;
          };
        }
        return async () => null;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 })),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function replaceLogo(user: ReturnType<typeof userEvent.setup>) {
      const theme = within(document.getElementById("sec-theme")!);
      await user.upload(
        theme.getByLabelText("theme.logoDarkLabel"),
        new File(["png"], "logo.png", { type: "image/png" }),
      );
      await waitFor(() => expect(theme.getByText("logo-dark-2.png")).toBeInTheDocument());
      return theme;
    }

    it("keeps the saved file when the owner replaces it and then resets", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const theme = await replaceLogo(user);
      expect(removed).toEqual([]);

      await user.click(theme.getByRole("button", { name: "fields.reset" }));

      expect(theme.getByText("logo-dark.svg")).toBeInTheDocument();
      expect(removed).toEqual([]);
    });

    it("deletes the replaced file only after a successful save", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      await replaceLogo(user);

      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      await waitFor(() =>
        expect(removed).toEqual([
          { libraryId: "library_123", url: "https://assets.example.test/logo-dark.svg" },
        ]),
      );
    });
  });
});
