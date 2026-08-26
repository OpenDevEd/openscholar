/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openOrganizationProfile: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({
    isLoaded: true,
    organization: { name: "Open Development" },
  }),
  useClerk: () => ({ openOrganizationProfile: mocks.openOrganizationProfile }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, string>) =>
      params?.org ? `${key}:${params.org}` : key,
}));

import { TeamSection } from "@/components/evidence-libraries/configuration/sections/team-section";

describe("TeamSection", () => {
  it("names the organisation whose admins own and members edit the library", () => {
    render(<TeamSection />);
    expect(screen.getByText("team.ownersHint:Open Development")).toBeTruthy();
    expect(screen.getByText("team.editorsHint:Open Development")).toBeTruthy();
    expect(
      document.getElementById("sec-team")?.getAttribute("data-organization"),
    ).toBe("Open Development");
  });

  it("opens the organisation settings from the manage button", async () => {
    render(<TeamSection />);
    await userEvent.click(
      screen.getByRole("button", { name: /team\.manageButton/ }),
    );
    expect(mocks.openOrganizationProfile).toHaveBeenCalledTimes(1);
  });
});
