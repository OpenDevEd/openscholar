/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSetupDraft: vi.fn(),
  push: vi.fn(),
  query: vi.fn(),
  useOrganization: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => mocks.useOrganization(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createSetupDraft,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      mutations: { createSetupDraft: "createSetupDraft" },
      queries: {
        getSetupDraft: "getSetupDraft",
      },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    mocks.query(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ title }: { title?: string }) => <section>{title}</section>,
}));

import { CreateEvidenceLibraryStep } from "@/components/evidence-libraries/create-evidence-library-step";

const activeAdminOrganization = {
  isLoaded: true,
  membership: { role: "org:admin" },
  organization: { id: "org_climate", name: "Climate Team" },
};

const savedSetup = {
  identity: {
    name: "Saved Library",
    publicAddress: "https://saved-library-lib.libraries.example.test",
    shortName: "Saved Library",
    slug: "saved-library",
  },
  library: { _id: "library_123" },
};

describe("<CreateEvidenceLibraryStep>", () => {
  beforeEach(() => {
    mocks.createSetupDraft.mockReset();
    mocks.push.mockReset();
    mocks.query.mockReset();
    mocks.useOrganization.mockReset();
  });

  it("shows the active organization but no setup controls to a member", () => {
    mocks.useOrganization.mockReturnValue({
      ...activeAdminOrganization,
      membership: { role: "org:member" },
    });

    render(<CreateEvidenceLibraryStep />);

    expect(screen.getByText("Climate Team")).toBeVisible();
    expect(screen.queryByLabelText("libraryNameLabel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "continue" }),
    ).not.toBeInTheDocument();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("reserves once, shows the saved values, and continues separately", async () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockImplementation((query: string, args: unknown) => {
      if (
        query === "getSetupDraft" &&
        typeof args === "object" &&
        args !== null &&
        "libraryId" in args
      ) {
        return { data: savedSetup, isReady: true };
      }
      return { data: undefined, isReady: true };
    });
    mocks.createSetupDraft.mockResolvedValue({ libraryId: "library_123" });
    const urlUpdates: URLSearchParams[] = [];
    const user = userEvent.setup();

    render(
      <NuqsTestingAdapter
        searchParams=""
        hasMemory
        onUrlUpdate={(event) => urlUpdates.push(event.searchParams)}
      >
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );
    await user.type(
      screen.getByLabelText("libraryNameLabel"),
      "Climate Evidence",
    );
    expect(
      screen.queryByLabelText("publicAddressLabel"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mocks.createSetupDraft).toHaveBeenCalledTimes(1);
      expect(mocks.createSetupDraft).toHaveBeenCalledWith({
        name: "Climate Evidence",
      });
      expect(urlUpdates.at(-1)?.get("libraryId")).toBe("library_123");
      expect(urlUpdates.at(-1)?.get("organizationId")).toBe("org_climate");
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue(
      "Saved Library",
    );
    expect(screen.getByLabelText("libraryNameLabel")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText("shortNameLabel")).toHaveValue(
      "Saved Library",
    );
    expect(screen.getByLabelText("shortNameLabel")).toHaveAttribute("readonly");
    const savedAddress = screen.getByLabelText("publicAddressLabel");
    expect(savedAddress).toHaveValue(
      "https://saved-library-lib.libraries.example.test",
    );
    expect(savedAddress).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button"));

    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith(
      "/evidence-libraries/library_123/configuration",
    );
  });

  it("reopens the exact saved draft from the URL", () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockReturnValue({ data: savedSetup, isReady: true });

    render(
      <NuqsTestingAdapter searchParams="?libraryId=library_123&organizationId=org_climate">
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraft", {
      libraryId: "library_123",
    });
    expect(mocks.createSetupDraft).not.toHaveBeenCalled();
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue(
      "Saved Library",
    );
    expect(screen.getByLabelText("shortNameLabel")).toHaveValue(
      "Saved Library",
    );
    expect(screen.getByLabelText("publicAddressLabel")).toHaveValue(
      "https://saved-library-lib.libraries.example.test",
    );
    expect(screen.getByLabelText("publicAddressLabel")).toHaveAttribute(
      "readonly",
    );
  });

  it("does not query a selected library from a different active organization", () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockImplementation((_query: string, args: unknown) => ({
      data: args === "skip" ? undefined : savedSetup,
      isReady: true,
    }));
    const searchParams = "?libraryId=library_123&organizationId=org_climate";
    const view = render(
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue(
      "Saved Library",
    );

    mocks.query.mockClear();
    mocks.useOrganization.mockReturnValue({
      ...activeAdminOrganization,
      organization: { id: "org_education", name: "Education Team" },
    });
    view.rerender(
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraft", "skip");
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue("");

    mocks.query.mockClear();
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    view.rerender(
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraft", {
      libraryId: "library_123",
    });
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue(
      "Saved Library",
    );
  });

  it("does not expose the create form before protected queries are ready", () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockReturnValue({ data: undefined, isReady: false });

    render(
      <NuqsTestingAdapter>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.createSetupDraft).not.toHaveBeenCalled();
  });

  it("submits 100 astral code points intact and rejects 101", async () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockImplementation((_query: string, args: unknown) => ({
      data: args === "skip" ? undefined : savedSetup,
      isReady: true,
    }));
    mocks.createSetupDraft.mockResolvedValue({ libraryId: "library_123" });
    const user = userEvent.setup();
    const validName = "😀".repeat(100);
    const invalidName = "😀".repeat(101);

    render(
      <NuqsTestingAdapter hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );
    const nameInput = screen.getByLabelText("libraryNameLabel");
    const submit = screen.getByRole("button");

    await user.type(nameInput, invalidName);
    expect(nameInput).toHaveValue(invalidName);
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mocks.createSetupDraft).not.toHaveBeenCalled();

    await user.clear(nameInput);
    await user.type(nameInput, validName);
    expect(nameInput).toHaveValue(validName);
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(mocks.createSetupDraft).toHaveBeenCalledWith({ name: validName });
    });
  });
});
