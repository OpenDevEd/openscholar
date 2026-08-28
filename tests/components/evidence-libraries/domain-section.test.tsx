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
  removing: boolean;
  deploymentPending: boolean;
  isApex: boolean;
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
    removing: false,
    deploymentPending: false,
    isApex: false,
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

  it("renders every domain the library holds, not just the first", () => {
    mocks.data.domains = [
      row(),
      row({ domainId: "domain_2", host: "www.example.org" }),
    ];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      document.querySelectorAll("[data-domain-host]"),
    ).toHaveLength(2);
    expect(
      document.querySelector("[data-domain-host='www.example.org']"),
    ).not.toBeNull();
    // Adding another is still offered until the limit.
    expect(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.add",
      }),
    ).toBeInTheDocument();
  });

  it("stops offering another domain at the limit", () => {
    mocks.data.domains = [1, 2, 3, 4, 5].map((index) =>
      row({ domainId: `domain_${index}`, host: `d${index}.example.org` }),
    );
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.queryByRole("button", {
        name: "evidenceLibraryConfiguration.domain.add",
      }),
    ).toBeNull();
  });

  it("shows the mock's own words for each state", () => {
    mocks.data.domains = [row({ state: "added" })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.status.pending"),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dns-status]")).toHaveAttribute(
      "data-dns-status",
      "pending",
    );
    unmount();

    mocks.data.domains = [row({ state: "active", attached: true })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.status.verified"),
    ).toBeInTheDocument();
  });

  it("names the reason the last check failed", () => {
    mocks.data.domains = [row({ state: "failed", failure: "no-records" })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.failure.no-records"),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dns-status]")).toHaveAttribute(
      "data-dns-status",
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

  it("explains that the top of a zone cannot carry the record", () => {
    // Whether a name is the top of its zone is read from its records on the
    // server; the section renders what it was told.
    mocks.data.domains = [row({ host: "example.co.uk", isApex: true })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.apex"),
    ).toBeInTheDocument();
    unmount();

    mocks.data.domains = [row({ host: "library.example.org", isApex: false })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.queryByText("evidenceLibraryConfiguration.domain.apex"),
    ).toBeNull();
  });

  it("stops checking a domain that is on its way out, but lets the removal finish", () => {
    mocks.data.domains = [row({ state: "active", attached: true, removing: true })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.checkDns",
      }),
    ).toBeDisabled();
    // A removal that stopped halfway is finished by pressing again, so this
    // one stays usable.
    expect(
      screen.getByRole("button", {
        name: /evidenceLibraryConfiguration\.domain\.removeAgain/,
      }),
    ).toBeEnabled();
  });

  it("asks before it changes the library's address, then changes it", async () => {
    mocks.data.domains = [row({ state: "active", attached: true })];
    mocks.setPrimary.mockResolvedValue({ address: "https://evidence.example.org" });
    render(<DomainSection libraryId={libraryId} />);
    await userEvent.click(screen.getByRole("switch"));
    // Everyone signed in is signed out by this, so nothing happens until the
    // owner says yes.
    expect(mocks.setPrimary).not.toHaveBeenCalled();
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.confirmOnTitle"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.confirmAction",
      }),
    );
    expect(mocks.setPrimary).toHaveBeenCalledWith({
      libraryId,
      domainId: "domain_1",
      primary: true,
    });
  });

  it("does nothing when the owner backs out of changing the address", async () => {
    mocks.data.domains = [row({ state: "active", attached: true })];
    render(<DomainSection libraryId={libraryId} />);
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.confirmCancel",
      }),
    );
    expect(mocks.setPrimary).not.toHaveBeenCalled();
  });

  it("lets the current address be switched off even when it stopped working", async () => {
    mocks.data.domains = [
      row({ state: "failed", failure: "wrong-target", role: "primary", attached: true }),
    ];
    render(<DomainSection libraryId={libraryId} />);
    // Taking the library back to its platform address is exactly what an
    // owner needs here.
    expect(screen.getByRole("switch")).toBeEnabled();
  });
});
