/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SourcesField } from "@/components/evidence-libraries/configuration/sections/sources-field";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";
import { zoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import type {
  EvidenceSourceEntry,
  OpenAlexSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import { OPENALEX_API_CREDENTIAL_KEY } from "@/lib/evidence-libraries/configuration/sources";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("convex/react", () => ({
  useAction: () => mocks.action,
  useMutation: () => mocks.mutation,
}));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (reference: string) => mocks.query(reference),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      credentials: { listCredentialMetadata: "credentials" },
      credentialActions: { writeCredential: "writeCredential" },
      openAlexSourceKey: { removeOpenAlexKey: "removeOpenAlexKey" },
    },
    zotero: {
      queries: { getConnectionStatus: "account" },
      libraryGroups: {
        listLibraryZoteroGroups: "groups",
        removeZoteroGroup: "removeGroup",
      },
      libraryGroupActions: {
        listMyZoteroGroups: "listGroups",
        connectZoteroGroup: "connectGroup",
      },
      actions: { startOAuth: "startOAuth" },
      mutations: { disconnect: "disconnect" },
    },
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString().slice(0, 10) }),
  useLocale: () => "en-GB",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const libraryId = "library_1" as Id<"evidenceLibraries">;
const openAlexSource: OpenAlexSourceEntry = {
  key: "openalex-education",
  provider: "openalex",
  enabled: true,
  writebackEnabled: false,
  settings: {
    name: "Education evidence",
    searchUrl: "/results/search-1?q=education&yf=2020&yt=2026",
    apiKeyMode: "platform",
    approvedQuery: {
      version: "query-v1",
      approvedAt: "2026-09-24T12:00:00.000Z",
      query: { search: "education", filter: "publication_year:2020-2026" },
    },
    downloadPdfs: false,
  },
};

function Harness({ initial = [] }: { initial?: EvidenceSourceEntry[] }) {
  const [value, setValue] = useState(initial);
  return (
    <TooltipProvider>
      <SourcesField
        libraryId={libraryId}
        value={value}
        onChange={setValue}
        tags={{}}
        onTagsChange={vi.fn()}
      />
    </TooltipProvider>
  );
}

describe("<SourcesField>", () => {
  beforeEach(() => {
    mocks.action.mockReset();
    mocks.mutation.mockReset();
    mocks.query.mockImplementation((reference: string) => ({
      data:
        reference === "account"
          ? { connected: true, zoteroUserId: "1", username: "owner" }
          : reference === "groups"
            ? [
                {
                  groupId: "42",
                  name: "Climate evidence",
                  isPublic: true,
                  itemCount: 12,
                  scopes: { read: true, write: true },
                },
              ]
            : [],
      isReady: true,
    }));
  });

  it("shows Zotero and OpenAlex in one source list without a total", () => {
    render(<Harness initial={[zoteroSourceEntry("42"), openAlexSource]} />);
    expect(
      screen.getByRole("list", { name: "Connected sources" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Climate evidence")).toBeInTheDocument();
    expect(screen.getByText("Education evidence")).toBeInTheDocument();
    expect(screen.getByText("education")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "common.filters" }),
    ).toHaveTextContent("searchFilters.filterLabelYear 2020 - 2026");
    expect(screen.queryByText(/2 sources/i)).not.toBeInTheDocument();
  });

  it("pauses an approved OpenAlex source in the saved draft", async () => {
    render(<Harness initial={[openAlexSource]} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Pause Education evidence" }),
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("keeps provider connections separate at the bottom", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(
      screen.getByRole("dialog", { name: "Source connections" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Zotero/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /OpenAlex/ })).toBeInTheDocument();
  });

  it("keeps a saved API key when switching a source to OpenScholar access", async () => {
    mocks.query.mockImplementation((reference: string) => ({
      data:
        reference === "credentials"
          ? [
              {
                credentialKey: OPENALEX_API_CREDENTIAL_KEY,
                maskedHint: "••••abcd",
              },
            ]
          : reference === "account"
            ? { connected: true, zoteroUserId: "1", username: "owner" }
            : [],
      isReady: true,
    }));
    render(
      <Harness
        initial={[
          {
            ...openAlexSource,
            settings: { ...openAlexSource.settings, apiKeyMode: "custom" },
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    await userEvent.click(screen.getByRole("tab", { name: /OpenAlex/ }));
    await userEvent.click(screen.getByRole("tab", { name: /OpenScholar/ }));
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("offers both source types from one Add source menu", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(
      screen.getByRole("menuitem", { name: /Zotero group/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /OpenAlex search/ }),
    ).toBeInTheDocument();
  });
});
