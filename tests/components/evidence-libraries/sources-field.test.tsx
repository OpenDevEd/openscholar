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

  it("offers the Zotero sign-in from the Add source menu when the admin has no connection", async () => {
    queries({ connected: false });
    mocks.startOAuth.mockResolvedValue({ authorizeUrl: "https://www.zotero.org/oauth/authorize?x" });
    render(<Harness />);
    await openAddMenu();
    const zotero = screen.getByRole("menuitem", { name: new RegExp(`^${ns}.zoteroGroup`) });
    expect(zotero).toHaveTextContent(`${ns}.zoteroConnectFirst`);
    await userEvent.click(zotero);
    const dialog = await screen.findByRole("dialog", { name: `${ns}.connectionsTitle` });
    expect(within(dialog).getByText(`${ns}.notConnected`)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: `${ns}.picker.title` })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: `${ns}.connect` }));
    await waitFor(() => expect(mocks.startOAuth).toHaveBeenCalled());
    expect(mocks.startOAuth.mock.calls[0][0]).toEqual({
      callbackUrl: "https://lane.convex.site/api/zotero/callback",
      returnTo: expect.stringMatching(/^\//),
    });
  });

  it("ticks several groups in the picker and connects each one into the section", async () => {
    queries({ connected: true });
    mocks.listMyGroups.mockResolvedValue({
      connected: true,
      username: "owner",
      zoteroUserId: "1",
      capped: false,
      groups: [
        { id: "42", name: "Climate evidence", isPublic: true, itemCount: 312 },
        { id: "77", name: "Private notes", isPublic: false, itemCount: 5 },
        { id: "99", name: "Old group", isPublic: true, itemCount: 1 },
      ],
    });
    mocks.connectGroup.mockImplementation(async ({ groupId }: { groupId: string }) => ({ groupId, name: groupId }));
    const onChange = vi.fn();
    render(<Harness initial={[zoteroSourceEntry("99")]} onChange={onChange} />);

    const table = await openGroupPicker();
    expect(await within(table).findByRole("checkbox", { name: "Old group" })).toBeDisabled();
    expect(within(table).getByText(`${ns}.picker.added`)).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("checkbox", { name: "Climate evidence" }));
    await userEvent.click(within(table).getByRole("checkbox", { name: "Private notes" }));
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":2}` }));
    await waitFor(() => expect(mocks.connectGroup).toHaveBeenCalledTimes(2));
    expect(mocks.connectGroup).toHaveBeenCalledWith({ libraryId, groupId: "42" });
    expect(mocks.connectGroup).toHaveBeenCalledWith({ libraryId, groupId: "77" });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([zoteroSourceEntry("99"), zoteroSourceEntry("42"), zoteroSourceEntry("77")]),
    );
  });

  it("pages the groups fifty at a time, searches them, and warns only at Zotero's ceiling", async () => {
    queries({ connected: true });
    const many = Array.from({ length: 120 }, (_, index) => ({
      id: String(index),
      name: `Group ${index}`,
      isPublic: true,
      itemCount: index,
    }));
    mocks.listMyGroups.mockResolvedValue({
      connected: true,
      username: "owner",
      zoteroUserId: "1",
      capped: true,
      groups: many,
    });
    render(<Harness />);
    const table = await openGroupPicker();
    expect(await within(table).findByText("Group 0")).toBeInTheDocument();
    expect(within(table).queryByText("Group 60")).not.toBeInTheDocument();
    expect(screen.getByText(`${ns}.picker.capped`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "evidenceLibraryConfiguration.picker.loadMore" }));
    expect(await within(table).findByText("Group 60")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: `${ns}.picker.search` }), "Group 119");
    expect(await within(table).findByText("Group 119")).toBeInTheDocument();
    expect(within(table).queryByText("Group 0")).not.toBeInTheDocument();
    // Zotero was asked once, not per page or per keystroke.
    expect(mocks.listMyGroups).toHaveBeenCalledTimes(1);
  });

  it("asks Zotero again when the first read failed", async () => {
    queries({ connected: true });
    mocks.listMyGroups
      .mockRejectedValueOnce(new Error("zotero is down"))
      .mockResolvedValue({
        connected: true,
        username: "owner",
        zoteroUserId: "1",
        capped: false,
        groups: [{ id: "42", name: "Climate evidence", isPublic: true, itemCount: 312 }],
      });
    render(<Harness />);
    await openGroupPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${ns}.picker.failed`);
    await userEvent.click(
      screen.getByRole("button", { name: "evidenceLibraryConfiguration.picker.tryAgain" }),
    );
    expect(await screen.findByText("Climate evidence")).toBeInTheDocument();
    expect(mocks.listMyGroups).toHaveBeenCalledTimes(2);
  });

  it("says nothing about a ceiling the account never reached", async () => {
    queries({ connected: true });
    mocks.listMyGroups.mockResolvedValue({
      connected: true,
      username: "owner",
      zoteroUserId: "1",
      capped: false,
      groups: [{ id: "42", name: "Climate evidence", isPublic: true, itemCount: 312 }],
    });
    render(<Harness />);
    await openGroupPicker();
    expect(await screen.findByText("Climate evidence")).toBeInTheDocument();
    expect(screen.queryByText(`${ns}.picker.capped`)).not.toBeInTheDocument();
  });

  it("keeps the groups it could not connect ticked", async () => {
    queries({ connected: true });
    mocks.listMyGroups.mockResolvedValue({
      connected: true,
      username: "owner",
      zoteroUserId: "1",
      capped: false,
      groups: [
        { id: "42", name: "Climate evidence", isPublic: true, itemCount: 312 },
        { id: "77", name: "Private notes", isPublic: false, itemCount: 5 },
      ],
    });
    mocks.connectGroup.mockImplementation(async ({ groupId }: { groupId: string }) => {
      if (groupId === "77") throw new Error("no access");
      return { groupId, name: groupId };
    });
    render(<Harness />);
    const table = await openGroupPicker();
    await userEvent.click(await within(table).findByRole("checkbox", { name: "Climate evidence" }));
    await userEvent.click(within(table).getByRole("checkbox", { name: "Private notes" }));
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":2}` }));
    expect(
      await screen.findByText('evidenceLibraryConfiguration.picker.pickedCount {"count":1}'),
    ).toBeInTheDocument();
    expect(within(table).getByRole("checkbox", { name: "Private notes" })).toBeChecked();
  });

  it("adds a public group from a pasted link and rejects other text", async () => {
    queries({ connected: true });
    mocks.listMyGroups.mockResolvedValue({ connected: true, username: "owner", zoteroUserId: "1", capped: false, groups: [] });
    mocks.connectGroup.mockResolvedValue({ groupId: "2405685", name: "Open evidence" });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await openGroupPicker();
    const link = screen.getByRole("textbox", { name: `${ns}.pasteLink` });
    await userEvent.type(link, "not a link{enter}");
    expect(screen.getByText(`${ns}.pasteInvalid`)).toBeInTheDocument();
    expect(mocks.connectGroup).not.toHaveBeenCalled();
    await userEvent.clear(link);
    await userEvent.type(link, "https://www.zotero.org/groups/2405685/open_evidence{enter}");
    await waitFor(() => expect(mocks.connectGroup).toHaveBeenCalledWith({ libraryId, groupId: "2405685" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([zoteroSourceEntry("2405685")]));
  });

  it("shows each group's facts, pauses it, and keeps write back off when the key cannot write", async () => {
    queries({ connected: true, groups: [group42, group77] });
    const onChange = vi.fn();
    render(<Harness initial={[zoteroSourceEntry("42"), zoteroSourceEntry("77")]} onChange={onChange} />);
    const row42 = document.querySelector<HTMLElement>('[data-group-id="42"]')!;
    const row77 = document.querySelector<HTMLElement>('[data-group-id="77"]')!;
    expect(row42).toHaveAttribute("data-health", "connected");
    expect(within(row42).getByText("312")).toBeInTheDocument();
    expect(within(row42).getByText(`${ns}.public`)).toBeInTheDocument();
    expect(within(row77).getByRole("switch", { name: `${ns}.writeback` })).toBeDisabled();
    expect(within(row77).getByRole("button", { name: `${ns}.reconnect` })).toBeInTheDocument();
    expect(within(row42).queryByRole("button", { name: `${ns}.reconnect` })).not.toBeInTheDocument();

    await userEvent.click(within(row42).getByRole("switch", { name: `${ns}.writeback` }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...zoteroSourceEntry("42"), writebackEnabled: true }, zoteroSourceEntry("77")]);
    await userEvent.click(
      within(row42).getByRole("button", { name: rowAction(`${ns}.pause`, "Climate evidence") }),
    );
    expect(onChange).toHaveBeenLastCalledWith([
      { ...zoteroSourceEntry("42"), writebackEnabled: true, enabled: false },
      zoteroSourceEntry("77"),
    ]);
    expect(document.querySelector('[data-group-id="42"]')).toHaveAttribute("data-health", "paused");
  });

  it("removes a group only after the owner confirms", async () => {
    queries({ connected: true, groups: [group42] });
    mocks.removeGroup.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<Harness initial={[zoteroSourceEntry("42")]} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: rowAction("common.remove", "Climate evidence") }),
    );
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.removeGroup).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.removeConfirm` }));
    await waitFor(() => expect(mocks.removeGroup).toHaveBeenCalledWith({ libraryId, groupId: "42" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([]));
  });

  it("keeps the tag rules folded in Connections and edits them as chips", async () => {
    queries({ connected: true });
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: `${ns}.connections` }));
    expect(
      screen.queryByRole("textbox", { name: `${ns}.tagRules.publish.label` }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.tagRulesHeading` }));
    const publish = screen.getByRole("textbox", { name: `${ns}.tagRules.publish.label` });
    expect(screen.getByText("_publish")).toBeInTheDocument();
    await userEvent.type(publish, "open{enter}");
    expect(screen.getByText("open")).toBeInTheDocument();
    for (const chip of ["_publish", "publishPDF", "open"]) {
      await userEvent.click(
        screen.getByRole("button", { name: `evidenceLibraryConfiguration.fields.removeChip {"value":"${chip}"}` }),
      );
    }
    expect(screen.getByText(`${ns}.tagRules.issues.publishEmpty`)).toBeInTheDocument();
  });
});
