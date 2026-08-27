/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openOrganizationProfile: vi.fn(),
  team: {
    organizationName: "Open Development",
    owners: [{ clerkUserId: "user_1", name: "Ada Lovelace", email: "ada@example.org" }],
    editors: [] as { clerkUserId: string; name: string; email: string }[],
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ openOrganizationProfile: mocks.openOrganizationProfile }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { evidenceLibraries: { queries: { listTeam: "listTeam" } } },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => ({ data: mocks.team, isReady: true }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, params?: Record<string, string>) =>
      params?.org ? `${namespace}.${key}:${params.org}` : `${namespace}.${key}`,
}));

import type { Id } from "@/convex/_generated/dataModel";
import { TeamSection } from "@/components/evidence-libraries/configuration/sections/team-section";

const libraryId = "library_1" as Id<"evidenceLibraries">;

describe("TeamSection", () => {
  it("lists the organisation admins as owners with name and email, and an empty editors state", () => {
    render(<TeamSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.team.ownersHint:Open Development"),
    ).toBeInTheDocument();
    const owners = within(document.querySelector("[data-role='owner']") as HTMLElement);
    expect(owners.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(owners.getByText("ada@example.org")).toBeInTheDocument();
    expect(owners.getByText("AL")).toBeInTheDocument();
    expect(document.querySelector("[data-role='editor']")).toBeNull();
    expect(screen.getByText("evidenceLibraryConfiguration.team.noEditors")).toBeInTheDocument();
    expect(document.getElementById("sec-team")?.getAttribute("data-organization")).toBe(
      "Open Development",
    );
  });

  it("shows an editor by email when the name is missing and a pending label when both are", () => {
    mocks.team.editors = [
      { clerkUserId: "user_2", name: "", email: "grace@example.org" },
      { clerkUserId: "user_3", name: "", email: "" },
    ];
    render(<TeamSection libraryId={libraryId} />);
    const editors = within(document.querySelector("[data-role='editor']") as HTMLElement);
    expect(editors.getAllByRole("listitem")).toHaveLength(2);
    expect(editors.getByText("grace@example.org")).toBeInTheDocument();
    expect(editors.getByText("evidenceLibraryConfiguration.team.pending")).toBeInTheDocument();
  });

  it("opens the organisation settings from the manage button", async () => {
    render(<TeamSection libraryId={libraryId} />);
    await userEvent.click(
      screen.getByRole("button", { name: /team\.manageButton/ }),
    );
    expect(mocks.openOrganizationProfile).toHaveBeenCalledTimes(1);
  });
});
