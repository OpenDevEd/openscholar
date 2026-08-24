/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/PageWrapper", () => ({
  PageWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock(
  "@/components/evidence-libraries/configuration/evidence-library-configuration-shell",
  () => ({
    EvidenceLibraryConfigurationShell: ({
      libraryId,
    }: {
      libraryId: string;
    }) => <output>{libraryId}</output>,
  }),
);

import ConfigurationPage from "@/app/evidence-libraries/[libraryId]/configuration/page";

describe("Evidence Library configuration route", () => {
  it("awaits the Next.js params before rendering the protected shell", async () => {
    render(
      await ConfigurationPage({
        params: Promise.resolve({ libraryId: "library_from_route" }),
      }),
    );

    expect(screen.getByText("library_from_route")).toBeVisible();
  });
});
