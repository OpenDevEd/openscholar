import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceLibrariesGate } from "@/components/auth/evidence-libraries-gate";

const { auth, child, home, path } = vi.hoisted(() => ({ auth: { phase: "authenticated" }, child: vi.fn(), home: vi.fn(), path: { value: "/evidence-communities" } }));
vi.mock("@/components/workspaces/item-home", async (original) => ({ ...(await original<typeof import("@/components/workspaces/item-home")>()), useItemHome: home }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/workspaces/href", () => ({ useWorkspaceSlug: () => undefined }));
vi.mock("@/components/providers/convex-provider", () => ({ useAuthReadiness: () => ({ phase: auth.phase, retryUserSync: vi.fn() }) }));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }), useTranslations: () => (key: string) => key }));
vi.mock("@/components/PageWrapper", () => ({ PageWrapper: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/auth/auth-state-panel", () => ({ AuthStatePanel: ({ variant }: { variant: string }) => <div role="status">{variant}</div> }));
function ProtectedContent() { child(); return <div>Protected content</div>; }
beforeEach(() => { child.mockClear(); home.mockReset(); path.value = "/evidence-communities"; auth.phase = "authenticated"; });

it("keeps the page unmounted while sign-in finishes, then opens it whatever the workspace's plan", () => {
  auth.phase = "initializing";
  const { rerender } = render(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  expect(child).not.toHaveBeenCalled();
  auth.phase = "authenticated";
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByText("Protected content")).toBeInTheDocument();
});

it("asks a signed-out visitor to sign in", () => {
  auth.phase = "anonymous";
  render(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("sign_in_required");
  expect(child).not.toHaveBeenCalled();
});

it("shows the page's own fallback while sign-in finishes and keeps it mounted when it's done", () => {
  const mounts = vi.fn();
  function Page({ pending = false }: { pending?: boolean }) { React.useEffect(() => { mounts(); }, []); return <div>{pending ? "Pending page" : "Page"}</div>; }
  const gate = () => <EvidenceLibrariesGate fallback={<Page pending />}><Page /></EvidenceLibrariesGate>;
  auth.phase = "initializing";
  const { rerender } = render(gate());
  expect(screen.getByText("Pending page")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  auth.phase = "authenticated";
  rerender(gate());
  expect(screen.getByText("Page")).toBeInTheDocument();
  expect(mounts).toHaveBeenCalledOnce();
});

it("waits while a link to a community of another of the person's workspaces is on its way there", () => {
  path.value = "/evidence-communities/library123/configuration";
  home.mockReturnValue(undefined);
  const { rerender } = render(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  home.mockReturnValue({ slug: "lab" });
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  expect(child).not.toHaveBeenCalled();
  // In none of their workspaces: it opens here, and its own queries say what the person may do.
  home.mockReturnValue(null);
  rerender(<EvidenceLibrariesGate><ProtectedContent /></EvidenceLibrariesGate>);
  expect(screen.getByText("Protected content")).toBeInTheDocument();
});
