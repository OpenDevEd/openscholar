/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TagRules } from "@/components/evidence-libraries/configuration/sections/tag-rules";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  listMyGroups: vi.fn(),
  connectGroup: vi.fn(),
  removeGroup: vi.fn(),
  disconnect: vi.fn(),
  startOAuth: vi.fn(),
  query: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ({
      listMyZoteroGroups: mocks.listMyGroups,
      connectZoteroGroup: mocks.connectGroup,
      startOAuth: mocks.startOAuth,
    })[ref],
  useMutation: (ref: string) => ({ removeZoteroGroup: mocks.removeGroup, disconnect: mocks.disconnect })[ref],
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    zotero: {
      actions: { startOAuth: "startOAuth" },
      mutations: { disconnect: "disconnect" },
      queries: { getConnectionStatus: "getConnectionStatus" },
      libraryGroups: { listLibraryZoteroGroups: "listLibraryZoteroGroups", removeZoteroGroup: "removeZoteroGroup" },
      libraryGroupActions: {
        listMyZoteroGroups: "listMyZoteroGroups",
        connectZoteroGroup: "connectZoteroGroup",
      },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: string) => mocks.query(query),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SourcesField } from "@/components/evidence-libraries/configuration/sections/sources-field";
import { zoteroSourceEntry } from "@/convex/zotero/sourceEntry";

const libraryId = "library_1" as Id<"evidenceLibraries">;
const ns = "evidenceLibraryConfiguration.sources";

function queries(input: { connected: boolean; groups: unknown[] }) {
  mocks.query.mockImplementation((query: string) => ({
    data:
      query === "getConnectionStatus"
        ? input.connected
          ? { connected: true, zoteroUserId: "1", username: "owner" }
          : { connected: false }
        : input.groups,
    isReady: true,
  }));
}

const group42 = {
  groupId: "42",
  name: "Climate evidence",
  isPublic: true,
  itemCount: 312,
  connectedByZoteroUsername: "owner",
  scopes: { read: true, write: true },
};
const group77 = { ...group42, groupId: "77", name: "Private notes", isPublic: false, scopes: { read: true, write: false } };

function Harness({ initial = [] as ReturnType<typeof zoteroSourceEntry>[], onChange = vi.fn() }) {
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

describe("<SourcesField>", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://lane.convex.site");
  });

  it("offers the Zotero sign-in when the admin has no connection and keeps the group tools off", async () => {
    queries({ connected: false, groups: [] });
    mocks.startOAuth.mockResolvedValue({ authorizeUrl: "https://www.zotero.org/oauth/authorize?x" });
    render(<Harness />);
    expect(screen.getByText(`${ns}.notConnected`)).toBeInTheDocument();
    expect(screen.getByText(`${ns}.connectFirst`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${ns}.addGroups` })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.connect` }));
    await waitFor(() => expect(mocks.startOAuth).toHaveBeenCalled());
    expect(mocks.startOAuth.mock.calls[0][0]).toEqual({
      callbackUrl: "https://lane.convex.site/api/zotero/callback",
      returnTo: expect.stringMatching(/^\//),
    });
  });

  it("ticks several groups in the picker and connects each one into the section", async () => {
    queries({ connected: true, groups: [] });
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
    expect(screen.getByText(`${ns}.connectedAs {"handle":"owner"}`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: `${ns}.addGroups` }));
    const table = await screen.findByRole("table", { name: `${ns}.picker.title` });
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
    queries({ connected: true, groups: [] });
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
    await userEvent.click(screen.getByRole("button", { name: `${ns}.addGroups` }));
    const table = await screen.findByRole("table", { name: `${ns}.picker.title` });
    expect(await within(table).findByText("Group 0")).toBeInTheDocument();
    expect(within(table).queryByText("Group 60")).not.toBeInTheDocument();
    expect(screen.getByText(`${ns}.picker.capped`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "evidenceLibraryConfiguration.picker.loadMore" }));
    expect(await within(table).findByText("Group 60")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: `${ns}.picker.search` }), "Group 119");
    await waitFor(() => expect(within(table).queryByText("Group 0")).not.toBeInTheDocument());
    expect(within(table).getByText("Group 119")).toBeInTheDocument();
    // Zotero was asked once, not per page or per keystroke.
    expect(mocks.listMyGroups).toHaveBeenCalledTimes(1);
  });

  it("keeps the groups it could not connect ticked", async () => {
    queries({ connected: true, groups: [] });
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
    await userEvent.click(screen.getByRole("button", { name: `${ns}.addGroups` }));
    const table = await screen.findByRole("table", { name: `${ns}.picker.title` });
    await userEvent.click(await within(table).findByRole("checkbox", { name: "Climate evidence" }));
    await userEvent.click(within(table).getByRole("checkbox", { name: "Private notes" }));
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":2}` }));
    expect(
      await screen.findByText('evidenceLibraryConfiguration.picker.pickedCount {"count":1}'),
    ).toBeInTheDocument();
    expect(within(table).getByRole("checkbox", { name: "Private notes" })).toBeChecked();
  });

  it("adds a public group from a pasted link and rejects other text", async () => {
    queries({ connected: true, groups: [] });
    mocks.connectGroup.mockResolvedValue({ groupId: "2405685", name: "Open evidence" });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
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
    const row42 = document.querySelector('[data-group-id="42"]')!;
    const row77 = document.querySelector('[data-group-id="77"]')!;
    expect(row42).toHaveAttribute("data-health", "connected");
    expect(within(row42 as HTMLElement).getByText("312")).toBeInTheDocument();
    expect(within(row42 as HTMLElement).getByText(`${ns}.public`)).toBeInTheDocument();
    expect(within(row77 as HTMLElement).getByRole("switch", { name: `${ns}.writeback` })).toBeDisabled();
    expect(within(row77 as HTMLElement).getByRole("button", { name: `${ns}.reconnect` })).toBeInTheDocument();
    expect(within(row42 as HTMLElement).queryByRole("button", { name: `${ns}.reconnect` })).not.toBeInTheDocument();

    await userEvent.click(within(row42 as HTMLElement).getByRole("switch", { name: `${ns}.writeback` }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...zoteroSourceEntry("42"), writebackEnabled: true }, zoteroSourceEntry("77")]);
    await userEvent.click(within(row42 as HTMLElement).getByRole("button", { name: `${ns}.pause` }));
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
    await userEvent.click(screen.getByRole("button", { name: `${ns}.remove` }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.removeConfirm` }));
    await waitFor(() => expect(mocks.removeGroup).toHaveBeenCalledWith({ libraryId, groupId: "42" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([]));
  });

  it("keeps the tag rules behind Advanced and edits them as chips", async () => {
    queries({ connected: true, groups: [] });
    render(<Harness />);
    expect(screen.queryByText(`${ns}.tagRulesHeading`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.advanced` }));
    expect(screen.getByText(`${ns}.tagRulesHeading`)).toBeInTheDocument();
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
