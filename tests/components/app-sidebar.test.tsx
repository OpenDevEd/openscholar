/**
 * @vitest-environment jsdom
 */
// The rail (#651): what it reads and which sections it opens.
import React from "react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

const reads = vi.hoisted(() => ({ screening: null as unknown, features: {} as Record<string, boolean>, mounted: [] as unknown[] }));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ number: (value: number, options?: { style?: string }) => (options?.style === "percent" ? `${Math.round(value * 100)}%` : String(value)) }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: vi.fn() }) }));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { fullName: "Ada", imageUrl: undefined, primaryEmailAddress: { emailAddress: "ada@example.org" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
  useAuth: () => ({ isLoaded: true, userId: "user_ada" }),
}));
vi.mock("convex/react", () => ({ useAction: () => vi.fn(), useMutation: () => vi.fn() }));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    screening: { queries: { getActiveScreeningJobProgress: "screening:getActiveScreeningJobProgress" } },
    extraction: { queries: { jobs: { runningJob: "extraction:runningJob" } } },
    organizations: { queries: { workspaces: "organizations:workspaces", myInvitations: "organizations:myInvitations" }, manage: { create: "create", invite: "invite", declineInvitation: "decline", confirmJoin: "confirmJoin" } },
    workspaces: { queries: { personal: "workspaces:personal", bySlug: "workspaces:bySlug" } },
  },
}));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (ref: string, args: unknown) => {
    reads.mounted.push(ref);
    if (args === "skip") return { data: undefined };
    if (ref === "workspaces:personal") return { data: "ws_own" };
    if (ref === "screening:getActiveScreeningJobProgress") return { data: reads.screening };
    if (ref === "organizations:workspaces") return { data: { page: [{ workspaceId: "ws_own", kind: "personal", name: "Ada", role: "admin" }], isDone: true, continueCursor: "" } };
    if (ref === "organizations:myInvitations") return { data: { page: [], isDone: true, continueCursor: "" } };
    return { data: null };
  },
  // The rail reads the workspace list for its card, which these tests don't open.
  useProtectedPaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
vi.mock("@/lib/auth/use-subscription-state", () => ({ useSubscriptionState: () => ({ account: null, catalog: null, resolvedPlan: null }) }));
vi.mock("@/lib/auth/use-organization-features", () => ({ useOrganizationFeatures: () => ({ data: reads.features }) }));
vi.mock("@/lib/feature-flags/hook", () => ({ useFeatureFlag: () => true, useFeatureFlagForPlan: () => true }));
vi.mock("@/lib/billing/catalog-provider", () => ({ useBillingCatalog: () => null }));
vi.mock("@/components/providers/convex-provider", () => ({ useAuthReadiness: () => ({ phase: "authenticated" }) }));
vi.mock("@/lib/research/reads", () => ({ useQueryShortcuts: () => undefined }));
vi.mock("@/lib/hooks", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/store", () => ({
  useSidebarStore: (selector?: (state: { isOpen: boolean; setOpen: () => void }) => unknown) => {
    const state = { isOpen: false, setOpen: vi.fn() };
    return selector ? selector(state) : state;
  },
  useCurrentQueryStore: () => ({ currentQuery: "" }),
  useKeywordExpansionStore: () => ({ keywords: {} }),
}));
vi.mock("@/components/logo", () => ({ LogoMark: () => <span /> }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/auth-button", () => ({ AuthButton: () => null }));
vi.mock("@/components/keyword-expansion-preview", () => ({ KeywordExpansionPreview: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dialog", () => ({ Dialog: () => null, DialogContent: () => null, DialogDescription: () => null, DialogHeader: () => null, DialogTitle: () => null }));

import { AppSidebar } from "@/components/app-sidebar";
import { WorkspacesProvider } from "@/components/workspaces/parts";
import { LOOK_COOKIE, lookKey } from "@/lib/workspaces/look-cache";

// The rail takes the workspace list from the page's provider, as the root layout gives it.
const renderSidebar = () =>
  render(
    <WorkspacesProvider>
      <AppSidebar firstWorkspace={{ slug: null }} />
    </WorkspacesProvider>,
  );

describe("<AppSidebar>", () => {
  beforeEach(() => {
    reads.mounted = [];
    reads.screening = null;
    reads.features = { extraction: true, evidenceLibraries: true };
  });

  it("rings Screen with the percent the active screening's query gives", () => {
    reads.screening = { jobId: "job_1", status: "processing", totalPapers: 100, processedPapers: 100, failedPapers: 0, qualifiedPapers: 80, percentComplete: 99 };
    renderSidebar();
    expect(reads.mounted).toContain("screening:getActiveScreeningJobProgress");
    expect(screen.getByText("99%")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("opens Extract and Publish only where the workspace has them", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "extract" })).toHaveAttribute("href", "/extraction");
    expect(screen.getByRole("link", { name: "publish" })).toHaveAttribute("href", "/evidence-libraries");
  });

  it("hydrates as the server drew it when the look cookie changed after the request", async () => {
    const rail = (
      <WorkspacesProvider>
        <AppSidebar firstWorkspace={{ slug: null, user: "user_ada" }} />
      </WorkspacesProvider>
    );
    const container = document.body.appendChild(document.createElement("div"));
    container.innerHTML = renderToString(rail);
    // The page before, or another tab, saves the workspace's look once the request has gone.
    document.cookie = `${LOOK_COOKIE}=${encodeURIComponent(JSON.stringify({ user: "user_ada", looks: { [lookKey(null)]: { kind: "personal", workspaceId: "ws_own", name: "Ada" } } }))}`;
    const mismatch = vi.fn();
    const root = await act(async () => hydrateRoot(container, rail, { onRecoverableError: mismatch }));
    onTestFinished(() => {
      act(() => root.unmount());
      container.remove();
      document.cookie = `${LOOK_COOKIE}=; Max-Age=0`;
    });
    expect(mismatch).not.toHaveBeenCalled();
    // Once hydrated, the rail takes the look the browser now has.
    expect(screen.getByRole("button", { name: "switchFrom" })).toBeInTheDocument();
  });

  it("hides Extract and Publish in a workspace without them", () => {
    reads.features = {};
    renderSidebar();
    expect(screen.queryByRole("link", { name: "extract" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "publish" })).not.toBeInTheDocument();
  });
});
