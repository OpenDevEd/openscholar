/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TagRules } from "@/components/evidence-libraries/configuration/sections/tag-rules";

const mocks = vi.hoisted(() => ({
  listMyGroups: vi.fn(),
  connectGroup: vi.fn(),
  removeGroup: vi.fn(),
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
  useMutation: () => mocks.removeGroup,
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    zotero: {
      actions: { startOAuth: "startOAuth" },
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

describe("<SourcesField>", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://lane.convex.site");
  });

  it("offers the Zotero connection when the owner has none", async () => {
    queries({ connected: false, groups: [] });
    mocks.startOAuth.mockResolvedValue({ authorizeUrl: "https://www.zotero.org/oauth/authorize?x" });
    render(<SourcesField libraryId={libraryId} value={[]} onChange={vi.fn()} tags={{}} onTagsChange={vi.fn()} />);
    expect(screen.getByText("evidenceLibrarySources.account.notConnected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "evidenceLibrarySources.account.connect" }));
    await waitFor(() => expect(mocks.startOAuth).toHaveBeenCalled());
    expect(mocks.startOAuth.mock.calls[0][0]).toEqual({
      callbackUrl: "https://lane.convex.site/api/zotero/callback",
      returnTo: expect.stringMatching(/^\//),
    });
  });

  it("adds a group from the picker and puts a draft entry without a key into the section", async () => {
    queries({ connected: true, groups: [] });
    mocks.listMyGroups.mockResolvedValue({
      connected: true,
      username: "owner",
      zoteroUserId: "1",
      groups: [
        { id: "42", name: "Climate evidence", isPublic: true, itemCount: 312, alreadyAdded: false },
        { id: "77", name: "Private notes", isPublic: false, itemCount: 5, alreadyAdded: true },
      ],
    });
    mocks.connectGroup.mockResolvedValue({ groupId: "42", name: "Climate evidence", isPublic: true, itemCount: 312, scopes: { read: true, write: true } });
    const onChange = vi.fn();
    render(<SourcesField libraryId={libraryId} value={[]} onChange={onChange} tags={{}} onTagsChange={vi.fn()} />);
    expect(screen.getByText('evidenceLibrarySources.account.connectedAs {"handle":"owner"}')).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "evidenceLibrarySources.addGroup" }));
    const list = await screen.findByRole("list", { name: "evidenceLibrarySources.pickerTitle" });
    expect(within(list).queryByText("Private notes")).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: /Climate evidence/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([zoteroSourceEntry("42")]));
    expect(mocks.connectGroup).toHaveBeenCalledWith({ libraryId, groupId: "42" });
    expect(JSON.stringify(onChange.mock.calls)).not.toContain("apiKey");
  });

  it("shows each group's facts, keeps write back off for read-only keys, and pauses through enabled", async () => {
    queries({ connected: true, groups: [group42, group77] });
    const onChange = vi.fn();
    const value = [zoteroSourceEntry("42"), { ...zoteroSourceEntry("77"), enabled: false }];
    render(<SourcesField libraryId={libraryId} value={value} onChange={onChange} tags={{}} onTagsChange={vi.fn()} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-health", "ready");
    expect(within(rows[0]).getByText("Climate evidence")).toBeInTheDocument();
    expect(within(rows[0]).getByText("evidenceLibrarySources.public")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("312")).not.toBeInTheDocument();
    expect(rows[1]).toHaveAttribute("data-health", "paused");

    const writeBack77 = within(rows[1]).getByRole("switch", { name: "evidenceLibrarySources.writeBack" });
    expect(writeBack77).toBeDisabled();
    expect(within(rows[1]).getByText("evidenceLibrarySources.writeBackUnavailable")).toBeInTheDocument();

    await userEvent.click(within(rows[0]).getByRole("switch", { name: "evidenceLibrarySources.writeBack" }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...zoteroSourceEntry("42"), writebackEnabled: true }, value[1]]);

    await userEvent.click(within(rows[1]).getByRole("switch", { name: "evidenceLibrarySources.pause" }));
    expect(onChange).toHaveBeenLastCalledWith([value[0], { ...zoteroSourceEntry("77"), enabled: true }]);
  });

  it("removes the group on the platform and from the section", async () => {
    queries({ connected: true, groups: [group42] });
    mocks.removeGroup.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<SourcesField libraryId={libraryId} value={[zoteroSourceEntry("42")]} onChange={onChange} tags={{}} onTagsChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "evidenceLibrarySources.remove" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    expect(mocks.removeGroup).toHaveBeenCalledWith({ libraryId, groupId: "42" });
  });

  it("edits tag rules as comma-separated lists, flags an empty publish rule, and follows a reset", async () => {
    queries({ connected: true, groups: [] });
    const onTagsChange = vi.fn();
    // The page owns the tags; this stands in for its draft state and reset.
    let setTags: (tags: TagRules) => void = () => {};
    function Harness() {
      const [tags, set] = useState<TagRules>({ publish: [] });
      setTags = set;
      return (
        <SourcesField
          libraryId={libraryId}
          value={[]}
          onChange={vi.fn()}
          tags={tags}
          onTagsChange={(next) => {
            onTagsChange(next);
            set(next);
          }}
        />
      );
    }
    render(<Harness />);
    const publish = screen.getByLabelText("evidenceLibrarySources.tagRules.publish");
    expect(publish).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("evidenceLibrarySources.tagRules.publishEmpty")).toBeInTheDocument();
    await userEvent.type(publish, "_publish, publishPDF");
    expect(onTagsChange).toHaveBeenLastCalledWith({ publish: ["_publish", "publishPDF"] });
    expect(publish).toHaveValue("_publish, publishPDF");
    act(() => setTags({ publish: ["_publish"] }));
    expect(publish).toHaveValue("_publish");
  });
});
