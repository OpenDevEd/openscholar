/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const protectedQueryMock = vi.fn();


vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@clerk/nextjs", () => ({
  OrganizationSwitcher: () => null,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizationFeatures: { get: "organizationFeatures:get" },
    screening: {
      queries: {
        getActiveScreeningJobProgress: "screening:getActiveScreeningJobProgress",
        listUserScreeningJobs: "screening:listUserScreeningJobs",
      },
    },
    evidenceLibraries: {
      queries: {
        getEvidenceLibrariesAccess: "evidenceLibraries:getEvidenceLibrariesAccess",
      },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (queryRef: unknown, args: unknown) =>
    protectedQueryMock(queryRef, args),
}));

vi.mock("@/lib/hooks", () => ({
  useIsMobile: () => false,
  useEffectiveSearchId: () => null,
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: () => true,
}));

vi.mock("@/components/providers/convex-provider", () => ({
  useAuthReadiness: () => ({ phase: "authenticated" }),
}));

vi.mock("@/lib/auth/use-sign-in-redirect", () => ({
  useSignInRedirect: () => vi.fn(),
}));

vi.mock("@/lib/search", () => ({
  restoreFromHistory: () => "/results/restored",
}));

const sidebarState = {
  isOpen: false,
  setOpen: vi.fn(),
  isCollapsed: false,
  toggle: vi.fn(),
  setCollapsed: vi.fn(),
  _hasHydrated: true,
};

vi.mock("@/lib/store", () => ({
  useSidebarStore: (
    selector?: (state: typeof sidebarState) => unknown,
  ) => (selector ? selector(sidebarState) : sidebarState),
  getSidebarDimensions: () => ({ currentWidth: 280 }),
  useCurrentQueryStore: () => ({ currentQuery: "" }),
  useKeywordExpansionStore: () => ({ keywords: {} }),
}));

vi.mock("@/lib/research/search-list", () => ({
  useSearchList: () => ({ items: [], page: 1, pageCount: 1, hasPages: false, canPrevious: false, canNext: false, previous: vi.fn(), next: vi.fn() }),
}));

vi.mock("motion/react", async () => {
  const ReactModule = await import("react");
  const makeMotionTag = (tag: keyof React.JSX.IntrinsicElements) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        animate: _animate,
        exit: _exit,
        initial: _initial,
        transition: _transition,
        whileHover: _whileHover,
        whileTap: _whileTap,
        ...domProps
      } = props;
      return ReactModule.createElement(tag, domProps, children);
    };

  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => makeMotionTag(tag as keyof React.JSX.IntrinsicElements),
      },
    ),
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

vi.mock("@/components/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));
vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => <button type="button">language</button>,
}));
vi.mock("@/components/auth-button", () => ({
  AuthButton: () => <button type="button">auth</button>,
}));
vi.mock("@/components/search-history-tab", () => ({
  SearchHistoryTab: () => <div data-testid="search-history-tab" />,
}));
vi.mock("@/components/keyword-expansion-preview", () => ({
  KeywordExpansionPreview: () => <div data-testid="keyword-expansion-preview" />,
}));
vi.mock("@/components/screening/screening-jobs-dialog", () => ({
  ScreeningJobsDialog: () => <div data-testid="screening-jobs-dialog" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SheetContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SheetHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <div data-testid="separator" />,
}));

import { AppSidebar } from "@/components/app-sidebar";

describe("<AppSidebar> Evidence Libraries nav item", () => {
  function answerQueries(enabled: boolean) {
    protectedQueryMock.mockImplementation((queryRef: unknown) =>
      queryRef === "organizationFeatures:get"
        ? { data: { evidenceLibraries: enabled, authors: enabled, extraction: enabled }, isReady: true }
        : { data: undefined, isReady: true },
    );
  }

  beforeEach(() => {
    protectedQueryMock.mockReset();
  });

  it("hides gated tools without an enabled organization", () => {
    answerQueries(false);

    render(<AppSidebar />);

    expect(
      screen.queryByRole("link", { name: "evidenceLibraries" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Authors" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "extraction" })).not.toBeInTheDocument();
  });

  it("shows the item when the organisation is switched on", () => {
    answerQueries(true);

    render(<AppSidebar />);

    expect(
      screen.getByRole("link", { name: "evidenceLibraries" }),
    ).toHaveAttribute("href", "/evidence-libraries");
  });
});
