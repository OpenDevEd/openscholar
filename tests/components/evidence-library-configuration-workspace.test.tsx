/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { TooltipProvider } from "@/components/ui/tooltip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const mutationMock = vi.hoisted(() => vi.fn());
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
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: { getDraft: "getDraft" },
      mutations: {
        activateConfiguration: "activateConfiguration",
        saveDraftSections: "saveDraftSections",
      },
      teardown: { requestDevelopmentTeardown: "requestDevelopmentTeardown" },
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) => mutationMock(mutation),
  useAction: (action: unknown) => mutationMock(action),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) => queryMock(query, args),
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

function renderWorkspace() {
  return render(
    <NuqsTestingAdapter>
      <TooltipProvider>
        <ConfigurationWorkspace libraryId="library_123" />
      </TooltipProvider>
    </NuqsTestingAdapter>,
  );
}

function identityCard() {
  return within(document.getElementById("sec-identity")!);
}

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    saved = [];
    activated = [];
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
    renderWorkspace();
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
    renderWorkspace();
    await user.click(screen.getByRole("radio", { name: /theme\.layout\.wide/ }));
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
    expect(request.sections.map((row) => row.sectionKey)).toEqual(["theme"]);
    expect(request.sections[0]?.payload).toEqual({ ...savedTheme, layout: "wide" });
  });

  it("shows Needs attention for a section with a problem and blocks Activate and Save", async () => {
    const user = userEvent.setup();
    renderWorkspace();
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
    renderWorkspace();
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

  it("keeps the short name and public address read-only", () => {
    renderWorkspace();
    const shortName = identityCard().getByRole("textbox", { name: "identity.shortNameLabel" });
    const address = identityCard().getByRole("textbox", { name: "identity.addressLabel" });
    expect(shortName).toHaveAttribute("aria-readonly", "true");
    expect(shortName).toHaveTextContent("saved-library");
    expect(address).toHaveAttribute("aria-readonly", "true");
    expect(address).toHaveTextContent(savedIdentity.baseUrl);
  });

  it("saves unsaved changes first, then activates with the new edit version", async () => {
    const user = userEvent.setup();
    renderWorkspace();
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
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "setUpAndActivate" }));
    await user.click(screen.getByRole("button", { name: "activateDraftConfirm" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/evidence-libraries/new?libraryId=library_123"),
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
    renderWorkspace();

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

  it("lets a new library be set up while its setup operation waits for the owner", () => {
    queryMock.mockReturnValue(
      draftResult({
        state: "provisioning",
        operation: { _id: "operation_1", kind: "setup", status: "queued", stage: "queued" },
      }),
    );
    renderWorkspace();
    expect(document.querySelector("[data-operation-stage]")).toBeNull();
    expect(screen.getByRole("button", { name: "setUpAndActivate" })).toBeEnabled();
  });

  it("shows the running stage and blocks Activate while an operation runs", () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: { _id: "operation_1", kind: "publish", status: "running", stage: "deployment" },
      }),
    );
    renderWorkspace();
    const banner = document.querySelector("[data-operation-stage='deployment']");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("stages.deployment");
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();
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
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "danger.deleteButton" }));
    const confirm = screen.getByRole("button", { name: "deleteDialog.confirm" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("deleteDialog.typeToConfirm"), "Saved Library");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(teardowns).toEqual([{ libraryId: "library_123", confirmationName: "Saved Library" }]),
    );
    expect(pushMock).toHaveBeenCalledWith("/evidence-libraries/new?teardownOperationId=operation_123");
  });
});
