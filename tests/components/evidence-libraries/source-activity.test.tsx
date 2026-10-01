/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { SourceActivityBand } from "@/components/evidence-libraries/configuration/sections/source-activity";
import type { SourceStatus } from "@/convex/evidenceLibraries/sourceStatusValidators";
import messages from "@/messages/en-GB.json";

// The provider module builds a Convex client on import; the band needs none.
vi.mock("@/components/providers/convex-provider", () => ({ useAuthReadiness: () => ({ canRunProtectedQueries: false }) }));

const base = {
  key: "openalex-1",
  provider: "openalex" as const,
  searchable: 179_152,
  searchFailed: 0,
  changed: null,
  lastSuccessAt: null,
  issues: {},
  pdfs: { added: 27_000, missed: 5_000 },
};

// The real messages run here, so a missing or renamed key fails the test.
function renderBand(status: SourceStatus, onRetry = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en-GB" messages={messages} timeZone="UTC">
      <SourceActivityBand
        status={status}
        provider="OpenAlex"
        issuesIn={{ address: "https://library.example.test", path: "/admin" }}
        onRetry={onRetry}
        retrying={false}
      />
    </NextIntlClientProvider>,
  );
}

describe("source activity band", () => {
  it("shows PDFs being added once the records are in, split into added and not downloaded", () => {
    renderBand({
      ...base,
      state: "running",
      phase: "pdfs",
      done: 32_000,
      total: 64_000,
      startedAt: "2026-09-29T01:00:00.000Z",
      minutesLeft: 150,
    });

    expect(screen.getByText("Add PDFs")).toBeInTheDocument();
    expect(screen.getByText("of 64,000 PDFs")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "PDF progress" })).toHaveAttribute("aria-valuenow", "32000");
    expect(screen.getByText("5,000 could not be downloaded")).toBeInTheDocument();
    expect(screen.getByText("3 h left")).toBeInTheDocument();
  });

  it("offers to retry the PDFs when the run stopped while adding them", () => {
    renderBand({
      ...base,
      state: "failed",
      failure: { code: "internal", details: "Storage upload failed", at: "2026-09-29T01:30:00.000Z" },
      failedIn: "pdfs",
    });

    expect(screen.getByRole("button", { name: "Retry PDFs" })).toBeInTheDocument();
    expect(screen.getByText(/Every record stays searchable/)).toBeInTheDocument();
  });

  it("leaves the PDF step out for a source without PDFs", () => {
    renderBand({ ...base, pdfs: null, state: "running", phase: "import", done: 10, total: 100, startedAt: "2026-09-29T01:00:00.000Z", minutesLeft: 5 });
    expect(screen.queryByText("Add PDFs")).not.toBeInTheDocument();
  });

  it("leaves the PDF step out for an up-to-date source without PDFs", () => {
    renderBand({ ...base, pdfs: null, state: "succeeded" });
    expect(screen.queryByText("Add PDFs")).not.toBeInTheDocument();
  });

  it("shows the PDF step for a run adding PDFs even when it sent no counts", () => {
    renderBand({ ...base, pdfs: undefined, state: "running", phase: "pdfs", done: 10, total: 100, startedAt: "2026-09-29T01:00:00.000Z", minutesLeft: 5 });
    expect(screen.getByText("Add PDFs")).toBeInTheDocument();
  });
});
