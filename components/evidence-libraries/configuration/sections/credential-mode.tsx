"use client";

import { useTranslations } from "next-intl";
import { ZenodoMark } from "@/components/icons/zenodo-mark";
import { FlaskConical, KeyRound } from "@/components/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PanelRow } from "../fields";

export type ActiveMode = "sandbox" | "custom";

/**
 * Which account a provider is used with: our sandbox, credentials typed in, or the person's own connected account
 * (Zenodo on a community only, `own`, #1237).
 */
export function CredentialMode<Mode extends string = ActiveMode>({
  provider,
  value,
  onChange,
  own,
  children,
}: {
  provider: string;
  value: Mode;
  onChange: (mode: Mode) => void;
  /** What the connected-account tab shows; without it there is no such tab. */
  own?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("publicationSettings");
  return (
    <Tabs
      value={value}
      onValueChange={(mode) => onChange(mode as Mode)}
      className="gap-4"
    >
      {/* Three ways don't fit a phone's width on one line: they wrap rather than being cut off. */}
      <TabsList aria-label={t("credentials", { provider })} className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
        <TabsTrigger value="sandbox">
          <FlaskConical />
          {t("sandbox")}
        </TabsTrigger>
        {own ? (
          <TabsTrigger value="own">
            <ZenodoMark className="size-4 rounded-[4px]" />
            {t("account")}
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="custom">
          <KeyRound />
          {t("custom")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sandbox">
        <PanelRow
          title={t("sandboxTitle")}
          hint={t("sandboxHint")}
          leading={<FlaskConical className="size-4 text-muted-foreground" />}
        />
      </TabsContent>
      {own ? <TabsContent value="own">{own}</TabsContent> : null}
      <TabsContent value="custom">{children}</TabsContent>
    </Tabs>
  );
}
