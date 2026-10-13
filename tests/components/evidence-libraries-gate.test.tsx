import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceLibrariesGate } from "@/components/auth/evidence-libraries-gate";

const { access, child, home, path } = vi.hoisted(() => ({ access: vi.fn(), child: vi.fn(), home: vi.fn(), path: { value: "/evidence-libraries" } }));
vi.mock("@/lib/workspaces/use-workspace-features", () => ({ useWorkspaceFeatures: access }));
vi.mock("@/components/workspaces/item-home", async (original) => ({ ...(await original<typeof import("@/components/workspaces/item-home")>()), useItemHome: home }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value, useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));
vi.mock("@/lib/workspaces/href", () => ({ useWorkspaceSlug: () => undefined, workspaceHref: (_slug: string | undefined, to: string) => to }));
vi.mock("@/components/providers/convex-provider", () => ({ useAuthReadiness: () => ({ retryUserSync: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/PageWrapper", () => ({ PageWrapper: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/auth/auth-state-panel", () => ({ AuthStatePanel: ({ variant }: { variant: string }) => <div role="status">{variant}</div> }));
function ProtectedContent() { child(); return <div>Protected content</div>; }
beforeEach(() => { child.mockClear(); home.mockReset(); path.value = "/evidence-libraries"; });

it("keeps protected queries unmounted while loading and when access is denied", () => {
  access.mockReturnValue({ phase: "authenticated", data: undefined });
  const { rerender } = render(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  expect(child).not.toHaveBeenCalled();
  access.mockReturnValue({ phase: "authenticated", data: { evidenceLibraries: false } });
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("no_access");
  expect(child).not.toHaveBeenCalled();
});

it("mounts allowed content and removes it when the workspace's plan stops including it", () => {
  access.mockReturnValue({ phase: "authenticated", data: { evidenceLibraries: true } });
  const { rerender } = render(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByText("Protected content")).toBeInTheDocument();
  access.mockReturnValue({ phase: "authenticated", data: { evidenceLibraries: false } });
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("no_access");
});

it("shows the page's own fallback while access is checked and keeps it mounted when access is granted", () => {
  const mounts = vi.fn();
  function Page({ pending = false }: { pending?: boolean }) { React.useEffect(() => { mounts(); }, []); return <div>{pending ? "Pending page" : "Page"}</div>; }
  const gate = () => <EvidenceLibrariesGate fallback={<Page pending />}><Page /></EvidenceLibrariesGate>;
  access.mockReturnValue({ phase: "initializing", data: undefined });
  const { rerender } = render(gate());
  expect(screen.getByText("Pending page")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  access.mockReturnValue({ phase: "authenticated", data: { evidenceLibraries: true } });
  rerender(gate());
  expect(screen.getByText("Page")).toBeInTheDocument();
  expect(mounts).toHaveBeenCalledOnce();
  access.mockReturnValue({ phase: "authenticated", data: { evidenceLibraries: false } });
  rerender(gate());
  expect(screen.getByRole("status")).toHaveTextContent("no_access");
});

it("waits, not refuses, while a link to a library of another of the person's workspaces is on its way there", () => {
  // Opened from their own workspace, whose plan has no Evidence Libraries: the library's organization has them.
  path.value = "/evidence-libraries/library123/configuration";
  access.mockReturnValue({ phase: "authenticated", data: { evidenceLibraries: false } });
  home.mockReturnValue(undefined);
  const { rerender } = render(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  home.mockReturnValue({ slug: "lab" });
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  // In none of their workspaces: this workspace's answer stands.
  home.mockReturnValue(null);
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("no_access");
  expect(child).not.toHaveBeenCalled();
});
