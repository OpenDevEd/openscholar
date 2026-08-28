/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  AdminExpiredLinkPanel,
  AdminNoAccessPanel,
  AdminNotReadyPanel,
  AdminOpenAdminPanel,
} from "@/components/evidence-libraries/admin-panels";
import messages from "@/messages/en-GB.json";

// The real messages run here, so a missing or renamed key fails the test.
function renderPanel(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en-GB" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("admin handoff panels", () => {
  it("names the organisation a person should ask to be added to", () => {
    const { container } = renderPanel(
      <AdminNoAccessPanel organisationName="Climate Team" />,
    );

    expect(container.querySelector("[data-admin-handoff='no_access']")).not.toBeNull();
    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(screen.getByText(/Climate Team/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to libraries" })).toHaveAttribute(
      "href",
      "/evidence-libraries",
    );
  });

  it("still explains the refusal when the organisation has no name to give", () => {
    renderPanel(<AdminNoAccessPanel organisationName={null} />);

    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(screen.queryByText(/null|undefined/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to libraries" })).toBeInTheDocument();
  });

  it("offers the setup page to an owner of a library that is not live yet", () => {
    const { container } = renderPanel(
      <AdminNotReadyPanel isOwner setupHref="/evidence-libraries/lib_1/setup" />,
    );

    expect(container.querySelector("[data-admin-handoff='not_ready']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "View setup" })).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_1/setup",
    );
  });

  it("gives an editor no setup link", () => {
    renderPanel(
      <AdminNotReadyPanel
        isOwner={false}
        setupHref="/evidence-libraries/lib_1/setup"
      />,
    );

    expect(screen.queryByRole("link", { name: "View setup" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to libraries" })).toBeInTheDocument();
  });

  it("offers one link to someone who lands here although they may go in", () => {
    const { container } = renderPanel(
      <AdminOpenAdminPanel adminHref="/evidence-libraries/lib_1/admin?return=%2Fadmin" />,
    );

    expect(container.querySelector("[data-admin-handoff='open_admin']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open admin area" })).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_1/admin?return=%2Fadmin",
    );
  });

  it("lets someone try again after a link failed, without carrying the failure along", () => {
    const { container } = renderPanel(
      <AdminExpiredLinkPanel retryHref="/evidence-libraries/lib_1/admin?return=%2Fadmin" />,
    );

    expect(container.querySelector("[data-admin-handoff='expired_link']")).not.toBeNull();
    const retry = screen.getByRole("link", { name: "Try again" });
    expect(retry).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_1/admin?return=%2Fadmin",
    );
    expect(retry.getAttribute("href")).not.toContain("error=");
  });
});
