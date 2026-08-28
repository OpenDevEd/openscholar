/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DomainRow = {
  domainId: string;
  host: string;
  role: "primary" | "redirect";
  state: "added" | "pointing" | "verified" | "active" | "failed";
  failure?: string;
  certificateState?: "pending" | "active" | "failed";
  attached: boolean;
  recordName: string;
  recordValue: string;
};

const mocks = vi.hoisted(() => ({
  data: {
    platformReady: true,
    platformAddress: "https://climate-lib.opendev.space",
    canonicalAddress: "https://climate-lib.opendev.space",
    target: "cname.openscholar.ai",
    live: true,
    domains: [] as DomainRow[],
  },
  addDomain: vi.fn(),
  checkDomain: vi.fn(),
  removeDomain: vi.fn(),
  setPrimary: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (reference: string) =>
    reference === "addDomain"
      ? mocks.addDomain
      : reference === "checkDomain"
        ? mocks.checkDomain
        : mocks.removeDomain,
  useMutation: () => mocks.setPrimary,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      domains: { listDomains: "listDomains" },
      domainActions: {
        addDomain: "addDomain",
        checkDomain: "checkDomain",
        removeDomain: "removeDomain",
      },
      versions: { setDomainPrimary: "setDomainPrimary" },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => ({ data: mocks.data, isReady: true }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, params?: Record<string, string>) =>
      params?.type ? `${namespace}.${key}:${params.type}` : `${namespace}.${key}`,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import type { Id } from "@/convex/_generated/dataModel";
import { DomainSection } from "@/components/evidence-libraries/configuration/sections/domain-section";

const libraryId = "library_1" as Id<"evidenceLibraries">;

function row(overrides: Partial<DomainRow> = {}): DomainRow {
  return {
    domainId: "domain_1",
    host: "evidence.example.org",
    role: "redirect",
    state: "added",
    attached: false,
    recordName: "_openscholar.evidence.example.org",
    recordValue: "os-verify=7f3a9c1e5b2d4a8f",
    ...overrides,
  };
}

describe("DomainSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data.platformReady = true;
    mocks.data.domains = [];
  });

  it("says custom domains are not set up when the platform has no account for them", () => {
    mocks.data.platformReady = false;
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.notSetUp"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "evidenceLibraryConfiguration.domain.add",
      }),
    ).toBeNull();
  });

  it("shows the platform address and asks for a domain when there is none", () => {
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("https://climate-lib.opendev.space"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.add",
      }),
    ).toBeDisabled();
  });

  it("shows both records the owner has to add, with the platform's CNAME target", () => {
    mocks.data.domains = [row()];
    render(<DomainSection libraryId={libraryId} />);
    const rows = screen.getAllByRole("row");
    const cname = within(rows[1] as HTMLElement);
    expect(cname.getByText("CNAME")).toBeInTheDocument();
    expect(cname.getByText("evidence.example.org")).toBeInTheDocument();
    expect(cname.getByText("cname.openscholar.ai")).toBeInTheDocument();
    const txt = within(rows[2] as HTMLElement);
    expect(txt.getByText("TXT")).toBeInTheDocument();
    expect(
      txt.getByText("_openscholar.evidence.example.org"),
    ).toBeInTheDocument();
    expect(txt.getByText("os-verify=7f3a9c1e5b2d4a8f")).toBeInTheDocument();
  });

  it("names the reason the last check failed", () => {
    mocks.data.domains = [row({ state: "failed", failure: "no-records" })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.failure.no-records"),
    ).toBeInTheDocument();
    expect(document.getElementById("sec-domain")).toHaveAttribute(
      "data-domain-state",
      "failed",
    );
  });

  it("checks the domain when the button is pressed", async () => {
    mocks.data.domains = [row()];
    mocks.checkDomain.mockResolvedValue({ status: "checked", state: "pointing" });
    render(<DomainSection libraryId={libraryId} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.checkDns",
      }),
    );
    expect(mocks.checkDomain).toHaveBeenCalledWith({
      libraryId,
      domainId: "domain_1",
    });
  });

  it("keeps the redirect switch off until the domain is working", () => {
    mocks.data.domains = [row({ state: "verified" })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    unmount();

    mocks.data.domains = [row({ state: "active", attached: true })];
    render(<DomainSection libraryId={libraryId} />);
    expect(screen.getByRole("switch")).toBeEnabled();
  });

  it("shows the certificate state only once the domain is attached", () => {
    mocks.data.domains = [row({ state: "verified" })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(document.querySelector("[data-certificate]")).toBeNull();
    unmount();

    mocks.data.domains = [
      row({ state: "verified", attached: true, certificateState: "pending" }),
    ];
    render(<DomainSection libraryId={libraryId} />);
    expect(document.querySelector("[data-certificate]")).toHaveAttribute(
      "data-certificate",
      "pending",
    );
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.tlsPending"),
    ).toBeInTheDocument();
  });

  it("explains that a bare domain cannot carry the record", () => {
    mocks.data.domains = [row({ host: "example.org" })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.apex"),
    ).toBeInTheDocument();
    unmount();

    mocks.data.domains = [row({ host: "library.example.org" })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.queryByText("evidenceLibraryConfiguration.domain.apex"),
    ).toBeNull();
  });

  it("sends the platform address to the domain when the switch is turned on", async () => {
    mocks.data.domains = [row({ state: "active", attached: true })];
    mocks.setPrimary.mockResolvedValue({ address: "https://evidence.example.org" });
    render(<DomainSection libraryId={libraryId} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(mocks.setPrimary).toHaveBeenCalledWith({
      libraryId,
      domainId: "domain_1",
      primary: true,
    });
  });
});
