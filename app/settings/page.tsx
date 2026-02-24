"use client";

import { UserProfile } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

export default function GeneralSettingsPage() {
  const t = useTranslations("settings");

  return (
    <div className="flex h-full min-h-screen flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("generalSettings")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("managePreferences")}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 py-4 sm:p-6">
        <div className="mx-auto w-full max-w-4xl">
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: {
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: "0",
                  boxSizing: "border-box",
                },
                cardBox: {
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: "0",
                  boxSizing: "border-box",
                },
                card: {
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: "0",
                  boxSizing: "border-box",
                },
                pageScrollBox: {
                  overflowX: "visible",
                },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
