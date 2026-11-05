"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { LogoMark } from "@/components/logo";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { api } from "@/convex/_generated/api";
import { showConfirmation } from "@/lib/confirmation";
import { SEARCH_SOURCE_FLAG, SEARCH_SOURCE_NAMES, type SearchSource } from "@/lib/search/source";
import { useSearchSource } from "@/lib/search/use-search-source";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";

const OPTIONS = [
  { id: "openscholar", label: SEARCH_SOURCE_NAMES.openscholar, icon: LogoMark },
  { id: "openalex", label: SEARCH_SOURCE_NAMES.openalex, icon: OpenAlexIcon },
] as const;

/** Which source every search on the site reads from. It changes search for everyone, so a change asks first. */
export function SearchSourceZone() {
  const t = useTranslations("settingsAdmin.switches.searchSource");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const active = useSearchSource();
  const setEnabled = useMutation(api.featureFlags.admin.setEnabled);
  const ask = (source: SearchSource) => {
    if (source === active) return;
    const name = SEARCH_SOURCE_NAMES[source];
    showConfirmation({
      title: t("confirmTitle", { name }),
      message: t("confirmMessage"),
      confirmText: t("confirmAction", { name }),
      cancelText: tc("cancel"),
      variant: "default",
      onConfirm: () => {
        setEnabled({ key: SEARCH_SOURCE_FLAG, enabled: source === "openscholar" }).catch((error: unknown) => {
          console.error("[settings] search source change failed", { source, error });
          toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
        });
      },
    });
  };
  return (
    <Zone label={t("group")}>
      <ul className={LIST}>
        <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t("label")}</span>
            <span className="block text-xs text-muted-foreground">{t("hint")}</span>
          </span>
          <Segmented label={t("label")} value={active} onChange={ask} options={[...OPTIONS]} />
        </li>
      </ul>
    </Zone>
  );
}
