/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: { getSetupDraft: "getSetupDraft" },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    queryMock(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { EvidenceLibraryConfigurationShell } from "@/components/evidence-libraries/configuration/evidence-library-configuration-shell";

describe("<EvidenceLibraryConfigurationShell>", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("reads the route library and shows only its saved setup identity", () => {
    queryMock.mockReturnValue({
      data: {
        identity: {
          name: "Saved Evidence Library",
          publicAddress: "https://saved-lib.libraries.example.test",
          shortName: "Saved Library",
          slug: "saved",
        },
      },
    });

    render(<EvidenceLibraryConfigurationShell libraryId="library_123" />);

    expect(queryMock).toHaveBeenCalledWith("getSetupDraft", {
      libraryId: "library_123",
    });
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue(
      "Saved Evidence Library",
    );
    expect(screen.getByLabelText("shortNameLabel")).toHaveValue(
      "Saved Library",
    );
    const address = screen.getByLabelText("publicAddressLabel");
    expect(address).toHaveValue(
      "https://saved-lib.libraries.example.test",
    );
    expect(address).toHaveAttribute("readonly");
  });
});
