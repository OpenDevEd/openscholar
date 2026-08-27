/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
      mutations: {
        activateConfiguration: "activateConfiguration",
        saveDraftSections: "saveDraftSections",
      },
      teardown: { requestDevelopmentTeardown: "requestDevelopmentTeardown" },
      uploads: { generateUploadUrl: "generateUploadUrl" },
      uploadActions: { upload: "upload", remove: "remove" },
      updates: { check: "check" },
      versions: {
        listVersions: "listVersions",
        startRuntimeUpdate: "startRuntimeUpdate",
        restoreRevision: "restoreRevision",
      },
    },
    zotero: {
      actions: { startOAuth: "startOAuth" },
      queries: { getConnectionStatus: "getConnectionStatus" },
      libraryGroups: { listLibraryZoteroGroups: "listLibraryZoteroGroups", removeZoteroGroup: "removeZoteroGroup" },
      libraryGroupActions: { listMyZoteroGroups: "listMyZoteroGroups", connectZoteroGroup: "connectZoteroGroup" },
      runtimeReadActions: {
        listLibraryCollections: "listLibraryCollections",
        listRecordInstitutions: "listRecordInstitutions",
      },
    },
  },
}));

// One action callback per test, as Convex gives one per mounted section; the
// Versions section caches its update check by that callback.
let checkAction: (args: unknown) => unknown;

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) => mutationMock(mutation),
  useAction: (action: unknown) =>
    action === "check" ? checkAction : mutationMock(action),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    query === "getConnectionStatus"
      ? { data: { connected: false }, isReady: true }
      : query === "listLibraryZoteroGroups" || query === "listVersions"
        ? { data: [], isReady: true }
        : query === "listTeam"
          ? { data: { organizationName: "Test Org", owners: [], editors: [] }, isReady: true }
          : queryMock(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { ConfigurationWorkspace } from "@/components/evidence-libraries/configuration/configuration-workspace";

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
  { sectionKey: "collections", payload: [] },
  { sectionKey: "search", payload: {} },
  { sectionKey: "filters", payload: {} },
  { sectionKey: "sources", payload: [] },
  { sectionKey: "content", payload: {} },
  { sectionKey: "citations", payload: {} },
  { sectionKey: "exports", payload: {} },
  { sectionKey: "analytics", payload: {} },
];

function draftResult(overrides: { operation?: unknown; state?: string } = {}) {
  return {
    data: {
      library: {
        _id: "library_123",
        name: "Saved Library",
        state: overrides.state ?? "active",
        organizationId: "organization_123",
      },
      draft: { _id: "draft_123", libraryId: "library_123", editVersion: 4 },
      operation: overrides.operation ?? null,
      sections: savedRows,
    },
    isReady: true,
  };
}

/**
 * The Versions section suspends until the update check answers. React retries
 * a suspended tree only inside an awaited act, so render and settle there.
 */
async function renderWorkspace() {
  await act(async () => {
    render(
      <NuqsTestingAdapter>
        <TooltipProvider>
          <ConfigurationWorkspace libraryId="library_123" />
        </TooltipProvider>
      </NuqsTestingAdapter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    saved = [];
    activated = [];
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

  it("saves only the sections that changed", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    expect(queryMock).toHaveBeenCalledWith("getDraft", { libraryId: "library_123" });

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
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
    expect(screen.getByRole("button", { name: "activate" })).toBeEnabled();

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

  it("resets a section back to the saved values", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
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
    await user.type(name, "Renamed Library");

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
          error: { code: "VALIDATION_ERROR", message: "The configuration is not valid", stage: "assembling" },
          issues: [
            { pointer: "/theme/colors/accent", message: "Value must match the pattern." },
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
    const link = within(notice as HTMLElement).getByRole("link", { name: "/theme/colors/accent" });
    expect(link).toHaveAttribute("href", "#sec-theme");
    await user.click(link);
    expect(screen.getByRole("link", { name: /sections\.theme/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
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
    const banner = document.querySelector("[data-operation-stage='deployment']");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("stages.deployment");
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();
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
    const banner = document.querySelector("[data-operation-stage]");
    expect(banner).toHaveTextContent("updatingSoftware");
    expect(banner).toHaveAttribute("data-operation-stage", "deployment");
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();
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
    await user.type(screen.getByLabelText("deleteDialog.typeToConfirm"), "Saved Library");
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

    it("clears the other target when a link changes what it goes to", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const navigation = card("navigation");
      await user.click(navigation.getByRole("button", { name: "navigation.addLink" }));
      const row = within(document.querySelector("[data-nav-link]") as HTMLElement);
      expect(row.getByRole("alert")).toHaveTextContent("links.labelError");
      await user.type(row.getByLabelText("links.labelLabel"), "About");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      await user.type(row.getByLabelText("links.urlLabel"), "https://example.org/about");
      expect(row.getByRole("switch", { name: "links.newTab" })).toBeInTheDocument();

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
      await user.type(contact.getByLabelText("contact.contactRecipient"), "team@example.org");
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
        await user.type(within(privacy).getByLabelText("contact.legalUrl"), "https://example.org/privacy");

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
      expect(card("sources").getByRole("button", { name: "evidenceLibrarySources.account.connect" })).toBeInTheDocument();
      expect(card("collections").getByRole("button", { name: "evidenceLibraryCollections.add" })).toBeInTheDocument();
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
      expect(downloads).toBeDisabled();
      expect(features.getByText("features.needsExports")).toBeInTheDocument();

      const risField = card("citations").getByLabelText("citations.formats.ris");
      await user.type(risField, "https://feeds.example.test/library.ris");
      expect(downloads).toBeEnabled();
      await user.click(downloads);
      expect(downloads).toBeChecked();

      await user.clear(risField);
      expect(downloads).toBeDisabled();
      expect(downloads).not.toBeChecked();
      expect(features.getByText("sectionState.complete")).toBeInTheDocument();
    });

    it("saves the typed Atom feed address and rejects the library's own address", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const atomField = card("citations").getByLabelText("citations.formats.atom");
      await user.type(atomField, `${savedIdentity.baseUrl}/lib/atom.xml`);
      expect(atomField).toHaveAttribute("aria-invalid", "true");
      expect(card("citations").getByText("problems.exportUrl")).toBeInTheDocument();
      await user.clear(atomField);
      await user.type(atomField, "https://feeds.example.test/library.atom");
      expect(atomField).not.toHaveAttribute("aria-invalid");
      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        { sectionKey: "exports", payload: { atom: "https://feeds.example.test/library.atom" } },
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

    it("lets PostHog and Google Analytics be on at the same time and checks both keys", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const analytics = card("analytics");
      expect(analytics.queryByLabelText("analytics.measurementIdLabel")).not.toBeInTheDocument();
      await user.click(analytics.getByRole("switch", { name: "analytics.googleLabel" }));
      expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
      await user.type(analytics.getByLabelText("analytics.measurementIdLabel"), "g-abcd12");
      expect(analytics.getByText("sectionState.edited")).toBeInTheDocument();

      await user.click(analytics.getByRole("switch", { name: "analytics.posthogLabel" }));
      expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
      await user.type(analytics.getByLabelText("analytics.hostLabel"), "https://eu.i.posthog.com");
      await user.type(analytics.getByLabelText("analytics.keyLabel"), "phc_12345678901234567890");
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
