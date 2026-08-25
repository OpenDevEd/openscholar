/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SetupSelection = {
  libraryId: string | null;
  organizationId: string | null;
};

type SetupSelectionUpdate =
  | Partial<SetupSelection>
  | ((current: SetupSelection) => Partial<SetupSelection> | null)
  | null;

type SetupSelectionSetter = (
  update: SetupSelectionUpdate,
  options?: unknown,
) => Promise<URLSearchParams>;

const mocks = vi.hoisted(() => ({
  createSetupDraft: vi.fn(),
  latestSetupSelection: {
    libraryId: null,
    organizationId: null,
  } as SetupSelection,
  push: vi.fn(),
  query: vi.fn(),
  retrySetup: vi.fn(),
  setupSelectionOverride: null as null | SetupSelectionSetter,
  useOrganization: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => mocks.useOrganization(),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) =>
    mutation === "retrySetup" ? mocks.retrySetup : mocks.createSetupDraft,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      "status.retry": "Retry",
      "status.retrying": "Retrying",
    })[key] ?? key,
}));

vi.mock("nuqs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nuqs")>();
  return {
    ...actual,
    useQueryStates: (keyMap: never, options: never) => {
      const [state, setState] = actual.useQueryStates(keyMap, options);
      const wrappedSetter: SetupSelectionSetter = (update, setOptions) =>
        mocks.setupSelectionOverride
          ? mocks.setupSelectionOverride(update, setOptions)
          : (setState as SetupSelectionSetter)(update, setOptions);
      return [state, wrappedSetter];
    },
  };
});

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      mutations: {
        createSetupDraft: "createSetupDraft",
        retrySetup: "retrySetup",
      },
      queries: {
        getSetupDraft: "getSetupDraft",
        getSetupDraftSelection: "getSetupDraftSelection",
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
  setupOperation: {
    _id: "setup_operation_123",
    status: "queued",
    stage: "queued",
  },
};

function savedSetupAt(
  status: "running" | "succeeded" | "failed",
  stage:
    | "database"
    | "storage"
    | "application"
    | "deployment"
    | "health_check"
    | "completed",
  error?: { code: string; message: string; stage: string },
) {
  return {
    ...savedSetup,
    setupOperation: {
      ...savedSetup.setupOperation,
      status,
      stage,
      ...(error ? { error } : {}),
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let resolveHandled!: () => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  const handled = new Promise<void>((resolvePromise) => {
    resolveHandled = resolvePromise;
  });
  const originalThen = promise.then.bind(promise);
  promise.then = ((onFulfilled, onRejected) =>
    originalThen(
      onFulfilled
        ? async (value) => {
            try {
              return await onFulfilled(value);
            } finally {
              resolveHandled();
            }
          }
        : undefined,
      onRejected,
    )) as typeof promise.then;
  return { handled, promise, resolve };
}

describe("<CreateEvidenceLibraryStep>", () => {
  beforeEach(() => {
    mocks.createSetupDraft.mockReset();
    mocks.push.mockReset();
    mocks.query.mockReset();
    mocks.retrySetup.mockReset();
    mocks.latestSetupSelection = {
      libraryId: null,
      organizationId: null,
    };
    mocks.setupSelectionOverride = null;
    mocks.useOrganization.mockReset();
  });

  it("shows the active organization but no setup controls to a member", () => {
    mocks.useOrganization.mockReturnValue({
      ...activeAdminOrganization,
      membership: { role: "org:member" },
    });

    render(
      <NuqsTestingAdapter>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

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
        query === "getSetupDraftSelection" &&
        typeof args === "object" &&
        args !== null &&
        "libraryId" in args
      ) {
        return { data: savedSetup, isReady: true };
      }
      return { data: undefined, isReady: true };
    });
    const pendingCreate = createDeferred<{ libraryId: string }>();
    mocks.createSetupDraft.mockImplementation(() => pendingCreate.promise);
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
      expect(urlUpdates.at(-1)?.get("libraryId")).toBeNull();
      expect(urlUpdates.at(-1)?.get("organizationId")).toBe("org_climate");
    });
    pendingCreate.resolve({ libraryId: "library_123" });
    await waitFor(() => {
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

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraftSelection", {
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

  it.each([
    "database",
    "storage",
    "application",
    "deployment",
    "health_check",
  ] as const)("shows the saved running %s step", (stage) => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockReturnValue({
      data: savedSetupAt("running", stage),
      isReady: true,
    });

    render(
      <NuqsTestingAdapter searchParams="?libraryId=library_123&organizationId=org_climate">
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-setup-status", "running");
    expect(status).toHaveAttribute("data-setup-step", stage);
    expect(status).toHaveAccessibleDescription(/.+/);
    expect(screen.queryByLabelText("libraryNameLabel")).not.toBeInTheDocument();
  });

  it("shows Ready from the saved completed operation", () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockReturnValue({
      data: savedSetupAt("succeeded", "completed"),
      isReady: true,
    });

    render(
      <NuqsTestingAdapter searchParams="?libraryId=library_123&organizationId=org_climate">
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-setup-status",
      "ready",
    );
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("shows the saved failed step and error, then retries that library", async () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockReturnValue({
      data: savedSetupAt("failed", "storage", {
        code: "STORAGE_UNAVAILABLE",
        message: "File storage could not be reached.",
        stage: "storage",
      }),
      isReady: true,
    });
    mocks.retrySetup.mockResolvedValue({
      operationId: "setup_operation_123",
      status: "running",
    });
    const user = userEvent.setup();

    render(
      <NuqsTestingAdapter searchParams="?libraryId=library_123&organizationId=org_climate">
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    const failure = screen.getByRole("alert");
    expect(failure).toHaveAttribute("data-setup-status", "failed");
    expect(failure).toHaveAttribute("data-setup-step", "storage");
    expect(failure).toHaveTextContent("File storage could not be reached.");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(mocks.retrySetup).toHaveBeenCalledOnce();
    expect(mocks.retrySetup).toHaveBeenCalledWith({
      libraryId: "library_123",
    });
  });

  it("treats a stale setup selection as a fresh form", () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockReturnValue({ data: null, isReady: true });

    render(
      <NuqsTestingAdapter searchParams="?libraryId=deleted_library&organizationId=org_climate">
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraftSelection", {
      libraryId: "deleted_library",
    });
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue("");
    expect(mocks.createSetupDraft).not.toHaveBeenCalled();
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

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraftSelection", "skip");
    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue("");

    mocks.query.mockClear();
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    view.rerender(
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraftSelection", {
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
    const pendingCreate = createDeferred<{ libraryId: string }>();
    mocks.createSetupDraft.mockImplementation(() => pendingCreate.promise);
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

  it("does not let an older organization create overwrite the latest selection", async () => {
    const organizationA = activeAdminOrganization;
    const organizationB = {
      ...activeAdminOrganization,
      organization: { id: "org_education", name: "Education Team" },
    };
    const createA = createDeferred<{ libraryId: string }>();
    const createB = createDeferred<{ libraryId: string }>();
    mocks.useOrganization.mockReturnValue(organizationA);
    mocks.query.mockReturnValue({ data: undefined, isReady: true });
    mocks.createSetupDraft
      .mockImplementationOnce(() => createA.promise)
      .mockImplementationOnce(() => createB.promise);
    mocks.setupSelectionOverride = async (update) => {
      const partial =
        typeof update === "function"
          ? update(mocks.latestSetupSelection)
          : (update ?? { libraryId: null, organizationId: null });
      if (partial) {
        mocks.latestSetupSelection = {
          ...mocks.latestSetupSelection,
          ...partial,
        };
      }
      return new URLSearchParams(
        Object.entries(mocks.latestSetupSelection).flatMap(([key, value]) =>
          value === null ? [] : [[key, value]],
        ),
      );
    };
    const user = userEvent.setup();
    const view = render(
      <NuqsTestingAdapter hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );

    await user.type(screen.getByLabelText("libraryNameLabel"), "Library A");
    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mocks.createSetupDraft).toHaveBeenCalledWith({
        name: "Library A",
      });
    });

    mocks.useOrganization.mockReturnValue(organizationB);
    view.rerender(
      <NuqsTestingAdapter hasMemory>
        <CreateEvidenceLibraryStep />
      </NuqsTestingAdapter>,
    );
    await user.type(screen.getByLabelText("libraryNameLabel"), "Library B");
    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mocks.createSetupDraft).toHaveBeenCalledWith({
        name: "Library B",
      });
    });

    await act(async () => {
      createB.resolve({ libraryId: "library_b" });
      await createB.handled;
    });
    await waitFor(() => {
      expect(mocks.latestSetupSelection).toEqual({
        libraryId: "library_b",
        organizationId: "org_education",
      });
    });

    await act(async () => {
      createA.resolve({ libraryId: "library_a" });
      await createA.handled;
    });
    expect(mocks.latestSetupSelection).toEqual({
      libraryId: "library_b",
      organizationId: "org_education",
    });
  });
});
