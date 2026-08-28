"use client";

import { useTranslations } from "next-intl";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";

/**
 * The three things the admin route can say when it does not send someone
 * straight to the library. Everything else on this route is a redirect, so
 * these panels are the whole visible surface.
 */
function AdminPanel({
  state,
  children,
}: {
  state: "no_access" | "not_ready" | "expired_link";
  children: React.ReactNode;
}) {
  return (
    <div
      className="container mx-auto max-w-4xl p-4 sm:p-6"
      data-admin-handoff={state}
    >
      {children}
    </div>
  );
}

export function AdminNoAccessPanel({
  organisationName,
}: {
  organisationName: string | null;
}) {
  const t = useTranslations("evidenceLibraries.admin");
  return (
    <AdminPanel state="no_access">
      <AuthStatePanel
        variant="no_access"
        title={t("noAccessTitle")}
        description={
          organisationName
            ? t("noAccessNamedDescription", { organisation: organisationName })
            : t("noAccessDescription")
        }
        primaryHref="/evidence-libraries"
        primaryLabel={t("backToLibraries")}
      />
    </AdminPanel>
  );
}

export function AdminNotReadyPanel({
  isOwner,
  setupHref,
}: {
  isOwner: boolean;
  setupHref: string;
}) {
  const t = useTranslations("evidenceLibraries.admin");
  return (
    <AdminPanel state="not_ready">
      <AuthStatePanel
        variant="no_access"
        title={t("notReadyTitle")}
        description={t("notReadyDescription")}
        primaryHref={isOwner ? setupHref : undefined}
        primaryLabel={isOwner ? t("viewSetup") : undefined}
        secondaryHref="/evidence-libraries"
        secondaryLabel={t("backToLibraries")}
      />
    </AdminPanel>
  );
}

export function AdminExpiredLinkPanel({ retryHref }: { retryHref: string }) {
  const t = useTranslations("evidenceLibraries.admin");
  return (
    <AdminPanel state="expired_link">
      <AuthStatePanel
        variant="sync_error_retry"
        title={t("expiredTitle")}
        description={t("expiredDescription")}
        primaryHref={retryHref}
        primaryLabel={t("tryAgain")}
        secondaryHref="/evidence-libraries"
        secondaryLabel={t("backToLibraries")}
      />
    </AdminPanel>
  );
}
