/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SourcesField } from "@/components/evidence-libraries/configuration/sections/sources-field";
import type { TagRules } from "@/components/evidence-libraries/configuration/sections/tag-rules";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";
import { zoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import type {
  EvidenceSourceEntry,
  OpenAlexSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import { OPENALEX_API_CREDENTIAL_KEY } from "@/lib/evidence-libraries/configuration/sources";

const mocks = vi.hoisted(() => ({
  listMyGroups: vi.fn(),
  connectGroup: vi.fn(),
  removeGroup: vi.fn(),
  disconnect: vi.fn(),
  startOAuth: vi.fn(),
  writeCredential: vi.fn(),
  removeOpenAlexKey: vi.fn(),
  query: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ({
      listMyZoteroGroups: mocks.listMyGroups,
      connectZoteroGroup: mocks.connectGroup,
      startOAuth: mocks.startOAuth,
      writeCredential: mocks.writeCredential,
    })[ref],
  useMutation: (ref: string) =>
    ({
      removeZoteroGroup: mocks.removeGroup,
      disconnect: mocks.disconnect,
      removeOpenAlexKey: mocks.removeOpenAlexKey,
    })[ref],
}));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: string) => mocks.query(query),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      credentials: { listCredentialMetadata: "listCredentialMetadata" },
      credentialActions: { writeCredential: "writeCredential" },
      openAlexSourceKey: { removeOpenAlexKey: "removeOpenAlexKey" },
    },
    zotero: {
      actions: { startOAuth: "startOAuth" },
      mutations: { disconnect: "disconnect" },
      queries: { getConnectionStatus: "getConnectionStatus" },
      libraryGroups: {
        listLibraryZoteroGroups: "listLibraryZoteroGroups",
        removeZoteroGroup: "removeZoteroGroup",
      },
      libraryGroupActions: {
        listMyZoteroGroups: "listMyZoteroGroups",
        connectZoteroGroup: "connectZoteroGroup",
      },
    },
  },
}));
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString().slice(0, 10) }),
  useLocale: () => "en-GB",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const newSearch: OpenAlexSourceEntry = {
  key: "openalex-new",
  provider: "openalex",
  enabled: true,
  writebackEnabled: false,
  settings: {
    name: "New search",
    searchUrl: "/results/search-2?q=schools",
    apiKeyMode: "platform",
    approvedQuery: {
      version: "query-v1",
      approvedAt: "2026-09-25T12:00:00.000Z",
      query: { search: "schools" },
    },
    downloadPdfs: false,
  },
};
// The search workspace itself is covered elsewhere; here it only hands back a search.
vi.mock(
  "@/components/evidence-libraries/configuration/sections/openalex-search-dialog",
  () => ({
    OpenAlexSearchDialog: ({
      onApprove,
    }: {
      onApprove: (source: OpenAlexSourceEntry) => void;
    }) => (
      <button type="button" onClick={() => onApprove(newSearch)}>
        approve search
      </button>
    ),
  }),
);

const libraryId = "library_1" as Id<"evidenceLibraries">;
const ns = "evidenceLibraryConfiguration.sources";
const rowAction = (action: string, name: string) =>
  `${ns}.sourceAction ${JSON.stringify({ action, name })}`;

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

const group42 = {
  groupId: "42",
  name: "Climate evidence",
  isPublic: true,
  itemCount: 312,
  connectedByZoteroUsername: "owner",
  scopes: { read: true, write: true },
};
const group77 = {
  ...group42,
  groupId: "77",
  name: "Private notes",
  isPublic: false,
  scopes: { read: true, write: false },
};

function queries(input: {
  connected: boolean;
  groups?: unknown[];
  credentials?: unknown[];
}) {
  mocks.query.mockImplementation((query: string) => ({
    data:
      query === "getConnectionStatus"
        ? input.connected
          ? { connected: true, zoteroUserId: "1", username: "owner" }
          : { connected: false }
        : query === "listCredentialMetadata"
          ? (input.credentials ?? [])
          : (input.groups ?? []),
    isReady: true,
  }));
}

function Harness({
  initial = [],
  onChange = vi.fn(),
}: {
  initial?: EvidenceSourceEntry[];
  onChange?: (value: EvidenceSourceEntry[]) => void;
}) {
  const [value, setValue] = useState(initial);
  const [tags, setTags] = useState<TagRules>({});
  return (
    <TooltipProvider>
      <SourcesField
        libraryId={libraryId}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        tags={tags}
        onTagsChange={setTags}
      />
    </TooltipProvider>
  );
}

async function openAddMenu() {
  await userEvent.click(screen.getByRole("button", { name: `${ns}.addSource` }));
}

async function openGroupPicker() {
  await openAddMenu();
  await userEvent.click(
    await screen.findByRole("menuitem", { name: new RegExp(`^${ns}.zoteroGroup`) }),
  );
  return screen.findByRole("table", { name: `${ns}.picker.title` });
}

describe("<SourcesField>", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://lane.convex.site");
  });

  it("shows Zotero and OpenAlex in one source list without a total", () => {
    queries({ connected: true, groups: [group42] });
    render(<Harness initial={[zoteroSourceEntry("42"), openAlexSource]} />);
    expect(screen.getByRole("list", { name: `${ns}.listLabel` })).toBeInTheDocument();
    expect(screen.getByText("Climate evidence")).toBeInTheDocument();
    expect(screen.getByText("Education evidence")).toBeInTheDocument();
    expect(screen.getByText("education")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "common.filters" })).toHaveTextContent(
      "2020 - 2026",
    );
    expect(screen.queryByText(/2 sources/i)).not.toBeInTheDocument();
  });

  it("pauses an approved OpenAlex source in the saved draft", async () => {
    queries({ connected: true });
    const onChange = vi.fn();
    render(<Harness initial={[openAlexSource]} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: rowAction(`${ns}.pause`, "Education evidence"),
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith([{ ...openAlexSource, enabled: false }]);
    expect(screen.getByText(`${ns}.health.paused`)).toBeInTheDocument();
  });

  it("offers both source types from one Add source menu", async () => {
    queries({ connected: true });
    render(<Harness />);
    await openAddMenu();
    expect(
      screen.getByRole("menuitem", { name: new RegExp(`^${ns}.zoteroGroup`) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: new RegExp(`^${ns}.openAlexSearch`) }),
    ).toBeInTheDocument();
  });

  it("keeps provider connections separate at the bottom", async () => {
    queries({ connected: true });
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: `${ns}.connections` }));
    expect(
      screen.getByRole("dialog", { name: `${ns}.connectionsTitle` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Zotero/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /OpenAlex/ })).toBeInTheDocument();
  });

  it("keeps a saved API key when switching a source to OpenScholar access", async () => {
    queries({
      connected: true,
      credentials: [{ credentialKey: OPENALEX_API_CREDENTIAL_KEY, maskedHint: "••••abcd" }],
    });
    render(
      <Harness
        initial={[
          { ...openAlexSource, settings: { ...openAlexSource.settings, apiKeyMode: "custom" } },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: `${ns}.connections` }));
    await userEvent.click(screen.getByRole("tab", { name: /OpenAlex/ }));
    await userEvent.click(screen.getByRole("tab", { name: /OpenScholar/ }));
    expect(mocks.removeOpenAlexKey).not.toHaveBeenCalled();
  });

});
