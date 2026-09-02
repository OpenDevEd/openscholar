/**
 * @vitest-environment jsdom
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";

type DomainRow = {
  domainId: string;
  host: string;
  role: "primary" | "redirect";
  state: "added" | "pointing" | "verified" | "active" | "failed";
  failure?: string;
  attached: boolean;
  removing: boolean;
  deploymentPending: boolean;
  isApex: boolean;
  suggestedWwwHost?: string;
  records: Array<{
    type: "A" | "CNAME" | "TXT";
    label: string;
    name: string;
    value: string;
  }>;
};

const mocks = vi.hoisted(() => ({
  data: {
    platformAddress: "https://climate-lib.opendev.space",
    canonicalAddress: "https://climate-lib.opendev.space",
    live: true,
    domains: [] as DomainRow[],
  },
  addDomain: vi.fn(),
  checkDomains: vi.fn(),
  removeDomain: vi.fn(),
  setPrimary: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (reference: string) =>
    reference === "addDomain"
      ? mocks.addDomain
      : reference === "checkDomains"
        ? mocks.checkDomains
        : mocks.removeDomain,
  useMutation: () => mocks.setPrimary,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      domains: { listDomains: "listDomains" },
      domainActions: {
        addDomain: "addDomain",
        checkDomains: "checkDomains",
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
    (namespace: string) => (key: string, params?: Record<string, string>) =>
      params?.type
        ? `${namespace}.${key}:${params.type}`
        : `${namespace}.${key}`,
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
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
    records: [
      {
        type: "CNAME",
        label: "evidence",
        name: "evidence.example.org",
        value: "cname.openscholar.ai",
      },
      {
        type: "TXT",
        label: "_openscholar",
        name: "_openscholar.evidence.example.org",
        value: "os-verify=7f3a9c1e5b2d4a8f",
      },
    ],
    ...overrides,
  };
}

describe("DomainSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data.domains = [];
  });

  it("asks for a domain when there is none", () => {
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByPlaceholderText("library.example.org"),
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
    const domain = document.querySelector(
      "[data-domain-host='evidence.example.org']",
    );
    expect(domain).not.toBeNull();
    const contents = within(domain as HTMLElement);
    expect(contents.getByText("CNAME")).toBeInTheDocument();
    expect(contents.getByText("evidence")).toBeInTheDocument();
    expect(contents.getAllByText("evidence.example.org")).toHaveLength(2);
    expect(contents.getByText("cname.openscholar.ai")).toBeInTheDocument();
    expect(contents.getByText("TXT")).toBeInTheDocument();
    expect(
      contents.getByText("_openscholar.evidence.example.org"),
    ).toBeInTheDocument();
    expect(
      contents.getByText("os-verify=7f3a9c1e5b2d4a8f"),
    ).toBeInTheDocument();
  });

  it("renders every domain the library holds, not just the first", () => {
    mocks.data.domains = [
      row(),
      row({ domainId: "domain_2", host: "www.example.org" }),
    ];
    render(<DomainSection libraryId={libraryId} />);
    expect(document.querySelectorAll("[data-domain-host]")).toHaveLength(2);
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

  it("keeps the platform address separate when a custom domain is present", () => {
    mocks.data.domains = [row({ state: "active", attached: true })];

    render(<DomainSection libraryId={libraryId} />);

    const platform = screen.getByRole("group", {
      name: "evidenceLibraryConfiguration.domain.platformLabel",
    });
    expect(
      within(platform).getByRole("link", { name: "climate-lib.opendev.space" }),
    ).toHaveAttribute("href", "https://climate-lib.opendev.space");
    expect(
      document.querySelector("[data-domain-host='evidence.example.org']"),
    ).not.toBeNull();
  });

  it("shows the apex A record and adds the recommended www host", async () => {
    mocks.data.domains = [
      row({
        host: "example.org",
        isApex: true,
        suggestedWwwHost: "www.example.org",
        records: [
          {
            type: "A",
            label: "@",
            name: "example.org",
            value: "203.0.113.80",
          },
          {
            type: "TXT",
            label: "_openscholar",
            name: "_openscholar.example.org",
            value: "os-verify=7f3a9c1e5b2d4a8f",
          },
        ],
      }),
    ];
    mocks.addDomain.mockResolvedValue({
      status: "added",
      domainId: "domain_2",
      isApex: false,
    });

    render(<DomainSection libraryId={libraryId} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.80")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.addWww",
      }),
    );
    expect(mocks.addDomain).toHaveBeenCalledWith({
      libraryId,
      host: "www.example.org",
    });
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
      screen.getByText(
        "evidenceLibraryConfiguration.domain.failure.no-records",
      ),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dns-status]")).toHaveAttribute(
      "data-dns-status",
      "failed",
    );
  });

  it("checks every domain through one button", async () => {
    mocks.data.domains = [
      row(),
      row({ domainId: "domain_2", host: "www.example.org" }),
    ];
    mocks.checkDomains.mockResolvedValue({ status: "checked", results: [] });
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getAllByRole("button", {
        name: "evidenceLibraryConfiguration.domain.checkDns",
      }),
    ).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.checkDns",
      }),
    );
    expect(mocks.checkDomains).toHaveBeenCalledWith({ libraryId });
  });

  it("reports a completed check with failed records as an error", async () => {
    mocks.data.domains = [row()];
    mocks.checkDomains.mockResolvedValue({
      status: "checked",
      results: [
        {
          domainId: "domain_1",
          state: "failed",
          failure: "no-records",
        },
      ],
    });
    render(<DomainSection libraryId={libraryId} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.checkDns",
      }),
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "evidenceLibraryConfiguration.domain.recordsNeedAttention",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("offers the primary-address action only when the domain is working", () => {
    mocks.data.domains = [row({ state: "verified" })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.queryByRole("button", {
        name: "evidenceLibraryConfiguration.domain.redirectLabel",
      }),
    ).toBeNull();
    unmount();

    mocks.data.domains = [row({ state: "active", attached: true })];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.redirectLabel",
      }),
    ).toBeEnabled();
  });

  it("shows the certificate state only once the domain is attached", () => {
    mocks.data.domains = [row({ state: "verified" })];
    const { unmount } = render(<DomainSection libraryId={libraryId} />);
    expect(document.querySelector("[data-certificate]")).toBeNull();
    unmount();

    mocks.data.domains = [row({ state: "verified", attached: true })];
    const pending = render(<DomainSection libraryId={libraryId} />);
    expect(document.querySelector("[data-certificate]")).toHaveAttribute(
      "data-certificate",
      "pending",
    );
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.tlsPending"),
    ).toBeInTheDocument();
    pending.unmount();

    mocks.data.domains = [row({ state: "active", attached: true })];
    render(<DomainSection libraryId={libraryId} />);
    expect(document.querySelector("[data-certificate]")).toHaveAttribute(
      "data-certificate",
      "active",
    );
    expect(
      screen.getByText("evidenceLibraryConfiguration.domain.tlsActive"),
    ).toBeInTheDocument();
  });

  it("stops checking a domain that is on its way out, but lets the removal finish", () => {
    mocks.data.domains = [
      row({ state: "active", attached: true, removing: true }),
    ];
    render(<DomainSection libraryId={libraryId} />);
    expect(
      screen.queryByRole("button", {
        name: "evidenceLibraryConfiguration.domain.checkDns",
      }),
    ).toBeNull();
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
    mocks.setPrimary.mockResolvedValue({
      address: "https://evidence.example.org",
    });
    render(<DomainSection libraryId={libraryId} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.redirectLabel",
      }),
    );
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
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.redirectLabel",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.confirmCancel",
      }),
    );
    expect(mocks.setPrimary).not.toHaveBeenCalled();
  });

  it("lets the current address be switched off even when it stopped working", async () => {
    mocks.data.domains = [
      row({
        state: "failed",
        failure: "wrong-target",
        role: "primary",
        attached: true,
      }),
    ];
    render(<DomainSection libraryId={libraryId} />);
    // Taking the library back to its platform address is exactly what an
    // owner needs here.
    expect(
      screen.getByRole("button", {
        name: "evidenceLibraryConfiguration.domain.confirmOffTitle",
      }),
    ).toBeEnabled();
  });
});
