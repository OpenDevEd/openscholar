/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const mutationMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: { getDraft: "getDraft" },
      mutations: {
        activateConfiguration: "activateConfiguration",
        saveEssentialConfiguration: "saveEssentialConfiguration",
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) => mutationMock(mutation),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) => queryMock(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { EvidenceLibraryConfigurationShell } from "@/components/evidence-libraries/configuration/evidence-library-configuration-shell";

const savedSections = {
  identity: {
    name: "Saved Evidence Library",
    shortName: "Saved Library",
    baseUrl: "https://saved-lib.libraries.example.test",
    assets: {
      logoDark: "https://assets.example.test/logo.svg",
      favicon: "https://assets.example.test/favicon.ico",
    },
  },
  theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
  localization: { locales: ["en-GB", "fr"], defaultLocale: "en-GB" },
};

const formContract = {
  fields: {
    name: { minLength: 1, maxLength: 100 },
    shortName: { minLength: 1, maxLength: 40 },
    colour: { pattern: "^#[0-9A-Fa-f]{6}$" },
  },
  locales: ["en-GB", "en-US", "de", "ar", "hi", "fr", "cn", "sw", "pt"],
};

function renderShell() {
  return render(
    <EvidenceLibraryConfigurationShell
      formContract={formContract}
      libraryId="library_123"
    />,
  );
}

function draftResult(sections = savedSections) {
  return {
    data: {
      library: { _id: "library_123", name: "Saved Evidence Library" },
      draft: { _id: "draft_123", editVersion: 4 },
      sections: Object.entries(sections).map(([sectionKey, payload]) => ({
        sectionKey,
        payload,
      })),
    },
    isReady: true,
  };
}

describe("<EvidenceLibraryConfigurationShell>", () => {
  beforeEach(() => {
    queryMock.mockReset();
    mutationMock.mockReset();
  });

  it("saves labelled visible fields while keeping the reserved address read-only", async () => {
    const user = userEvent.setup();
    let savedInput: unknown;
    queryMock.mockReturnValue(draftResult());
    mutationMock.mockImplementation((mutation) =>
      mutation === "saveEssentialConfiguration"
        ? async (input: unknown) => {
            savedInput = input;
            return { editVersion: 5 };
          }
        : async () => ({ status: "queued" }),
    );

    renderShell();

    expect(queryMock).toHaveBeenCalledWith("getDraft", {
      libraryId: "library_123",
    });
    const address = screen.getByLabelText("publicAddressLabel");
    expect(address).toHaveValue(savedSections.identity.baseUrl);
    expect(address).toHaveAttribute("readonly");

    await user.clear(screen.getByLabelText("libraryNameLabel"));
    await user.type(
      screen.getByLabelText("libraryNameLabel"),
      "Edited Library",
    );
    await user.clear(screen.getByLabelText("accentColourLabel"));
    await user.type(screen.getByLabelText("accentColourLabel"), "#123456");
    await user.selectOptions(
      screen.getByLabelText("defaultLanguageLabel"),
      "fr",
    );
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(savedInput).toEqual({
        libraryId: "library_123",
        expectedEditVersion: 4,
        sections: {
          ...savedSections,
          identity: { ...savedSections.identity, name: "Edited Library" },
          theme: {
            colors: { ...savedSections.theme.colors, accent: "#123456" },
          },
          localization: {
            locales: ["en-GB", "fr"],
            defaultLocale: "fr",
          },
        },
      }),
    );
  });

  it("previews saved values and activates the saved draft revision", async () => {
    const user = userEvent.setup();
    let activationInput: unknown;
    queryMock.mockReturnValue(draftResult());
    mutationMock.mockImplementation((mutation) =>
      mutation === "activateConfiguration"
        ? async (input: unknown) => {
            activationInput = input;
            return { kind: "setup", status: "queued" };
          }
        : async () => ({ editVersion: 5 }),
    );

    renderShell();
    await user.clear(screen.getByLabelText("libraryNameLabel"));
    await user.type(screen.getByLabelText("libraryNameLabel"), "Unsaved name");
    await user.click(screen.getByRole("button", { name: "preview" }));

    const preview = screen.getByRole("dialog");
    expect(preview).toHaveTextContent("Saved Evidence Library");
    expect(preview).not.toHaveTextContent("Unsaved name");

    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    await user.click(screen.getByRole("button", { name: "activate" }));
    await waitFor(() =>
      expect(activationInput).toEqual({
        libraryId: "library_123",
        expectedEditVersion: 4,
      }),
    );
  });

  it("focuses the first invalid visible field before saving", async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(
      draftResult({
        ...savedSections,
        identity: {
          ...savedSections.identity,
          assets: { ...savedSections.identity.assets, logoDark: "" },
        },
      }),
    );
    mutationMock.mockImplementation(() => async () => ({}));

    renderShell();
    await user.click(screen.getByRole("button", { name: "save" }));

    expect(document.activeElement).toBe(screen.getByLabelText("logoLabel"));
    expect(screen.getByLabelText("logoLabel")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
