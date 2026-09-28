/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  searchParams: new URLSearchParams(),
  signOut: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: mocks.signOut }),
  useUser: () => ({
    user: {
      firstName: "Test",
      lastName: "Admin",
      primaryEmailAddress: { emailAddress: "admin@example.test" },
      imageUrl: null,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/providers/convex-provider", () => ({
  useAuthReadiness: () => ({ phase: "authenticated" }),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useOptionalAuthQuery: () => ({ data: undefined, settlement: "ready" }),
}));

vi.mock("@/lib/auth/use-subscription-state", () => ({
  useSubscriptionState: () => ({
    isReady: true,
    isSettling: false,
    resolvedPlan: "free",
  }),
}));

vi.mock("@/lib/auth/use-sign-in-redirect", () => ({
  useSignInRedirect: () => vi.fn(),
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { billing: { accounts: { mine: "getMyBalance" } } },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <>{children}</>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AvatarFallback: ({ children }: React.PropsWithChildren) => (
    <span>{children}</span>
  ),
  AvatarImage: () => null,
}));

import { AuthButton } from "@/components/auth-button";

describe("<AuthButton> sign out", () => {
  beforeEach(() => {
    mocks.pathname = "/";
    mocks.searchParams = new URLSearchParams();
    mocks.signOut.mockReset();
    mocks.signOut.mockResolvedValue(undefined);
  });

  it("returns to home when signing out from home", async () => {
    const user = userEvent.setup();

    render(<AuthButton />);
    await user.click(screen.getByRole("button", { name: "signOut" }));

    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/" });
  });

  it("returns to home when signing out from another route", async () => {
    mocks.pathname = "/settings/ai";
    mocks.searchParams = new URLSearchParams({ tab: "models" });
    const user = userEvent.setup();

    render(<AuthButton />);
    await user.click(screen.getByRole("button", { name: "signOut" }));

    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/" });
  });
});
