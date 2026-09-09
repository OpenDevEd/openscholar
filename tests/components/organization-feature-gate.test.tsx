import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrganizationFeatureGate } from "@/components/auth/organization-feature-gate";

const { access, child } = vi.hoisted(() => ({ access: vi.fn(), child: vi.fn() }));
vi.mock("@/lib/auth/use-organization-features", () => ({ useOrganizationFeatures: access }));
vi.mock("@/components/providers/convex-provider", () => ({ useAuthReadiness: () => ({ retryUserSync: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/PageWrapper", () => ({ PageWrapper: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/auth/auth-state-panel", () => ({ AuthStatePanel: ({ variant }: { variant: string }) => <div role="status">{variant}</div> }));
function ProtectedContent() { child(); return <div>Protected content</div>; }
beforeEach(() => { child.mockClear(); });

it("keeps protected queries unmounted while loading and when access is denied", () => {
  access.mockReturnValue({ phase: "authenticated", data: undefined });
  const { rerender } = render(<OrganizationFeatureGate feature="authors"><ProtectedContent /></OrganizationFeatureGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  expect(child).not.toHaveBeenCalled();
  access.mockReturnValue({ phase: "authenticated", data: { authors: false } });
  rerender(<OrganizationFeatureGate feature="authors"><ProtectedContent /></OrganizationFeatureGate>);
  expect(screen.getByRole("status")).toHaveTextContent("no_access");
  expect(child).not.toHaveBeenCalled();
});

it("mounts allowed content and removes it when a membership grant is revoked", () => {
  access.mockReturnValue({ phase: "authenticated", data: { authors: true } });
  const { rerender } = render(<OrganizationFeatureGate feature="authors"><ProtectedContent /></OrganizationFeatureGate>);
  expect(screen.getByText("Protected content")).toBeInTheDocument();
  access.mockReturnValue({ phase: "authenticated", data: { authors: false } });
  rerender(<OrganizationFeatureGate feature="authors"><ProtectedContent /></OrganizationFeatureGate>);
  expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("no_access");
});
