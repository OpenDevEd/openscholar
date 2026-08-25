"use client";

import { Lock, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { initialsOf, type LibraryConfig } from "@/lib/evidence-libraries/mock/data";

/** Fake browser window used by the preview sheet and the admin "new tab" dialog. */
export function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-background">
      <div className="flex items-center gap-3 border-b border-border/40 bg-muted/30 px-3 py-2">
        <div className="flex gap-1.5" aria-hidden="true">
          <i className="size-2.5 rounded-full bg-red-400" />
          <i className="size-2.5 rounded-full bg-amber-400" />
          <i className="size-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex h-7 flex-1 items-center gap-2 rounded-md border border-border/50 bg-background px-2 font-mono text-xs text-muted-foreground">
          <Lock className="size-3" />
          <span className="truncate">{url}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function SiteNav({
  config,
  title,
  links,
}: {
  config: LibraryConfig;
  title: string;
  links: string[];
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 text-white"
      style={{ background: config.accent }}
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-white/20 text-[10px] font-bold">
        {initialsOf(config.name)}
      </span>
      <span className="truncate text-sm font-semibold">{title}</span>
      <span className="ml-auto hidden gap-3 text-xs opacity-90 sm:flex">
        {links.map((link) => (
          <span key={link}>{link}</span>
        ))}
      </span>
    </div>
  );
}

function Tag({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  );
}

/** Small header-and-hero preview shown next to the colour inputs. */
export function MiniNavbarPreview({ config }: { config: LibraryConfig }) {
  const t = useTranslations("evidenceLibraryMock.site");
  const tc = useTranslations("evidenceLibraryMock.config");
  const name = config.name || tc("untitled");
  return (
    <div
      aria-label={tc("livePreviewAria")}
      className="overflow-hidden rounded-xl border border-border/50 bg-background"
      data-mini-preview
    >
      <SiteNav
        config={{ ...config, name }}
        title={name}
        links={[t("navSearch"), t("navCollections"), t("navAbout"), config.defaultLanguage]}
      />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Search className="size-3.5" />
          {t("searchPlaceholder", { name })}
        </div>
        <div className="flex gap-2">
          <Tag color={config.secondary}>{t("tagReview")}</Tag>
          <Tag color={config.secondary}>{t("tagRegion")}</Tag>
        </div>
        <span
          className="inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
          style={{ background: config.accent }}
        >
          {t("browse")}
        </span>
      </div>
    </div>
  );
}

/** Mock of the public home page used by the Preview sheet. */
export function PublicSitePreview({ config, address }: { config: LibraryConfig; address: string }) {
  const t = useTranslations("evidenceLibraryMock.site");
  const topic = config.name.replace(/ (Hub|Review|Library)$/i, "");
  const cards = [
    { title: t("card1"), meta: t("card1Meta"), tag: t("tagCollection") },
    { title: t("card2"), meta: t("card2Meta"), tag: t("tagCollection") },
    { title: t("card3"), meta: t("card3Meta"), tag: t("tagCollection") },
    { title: t("card4"), meta: t("card4Meta"), tag: t("tagGapMap") },
  ];
  return (
    <BrowserFrame url={`https://${address}/`}>
      <SiteNav
        config={config}
        title={config.name}
        links={[
          t("navSearch"),
          t("navCollections"),
          t("navGapMaps"),
          t("navAbout"),
          config.defaultLanguage,
        ]}
      />
      <div className="space-y-3 border-b px-5 py-6">
        <h3 className="text-xl font-semibold tracking-tight">
          {t("heroTitle", { topic })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("heroMeta", { count: config.languages.length })}
        </p>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1 pl-3 pr-1 text-xs text-muted-foreground">
          <Search className="size-3.5" />
          <span className="flex-1 truncate">{t("heroSearch")}</span>
          <span
            className="rounded px-2 py-1 text-[11px] font-medium text-white"
            style={{ background: config.accent }}
          >
            {t("heroGo")}
          </span>
        </div>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {cards.map((card) => (
          <div key={card.title} className="space-y-1 rounded-md border p-3">
            <p className="text-sm font-medium">{card.title}</p>
            <p className="text-xs text-muted-foreground">{card.meta}</p>
            <Tag color={config.secondary}>{card.tag}</Tag>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-[11px] text-muted-foreground">
        <span>{config.name}</span>
        <span>{t("footLanguages", { languages: config.languages.join(", ") || "none" })}</span>
        <span>{t("footPowered")}</span>
      </div>
    </BrowserFrame>
  );
}

/** Mock of the Evidence Library admin landing page after a one-time-code sign-in. */
export function AdminSitePreview({
  config,
  address,
  activeRev,
}: {
  config: LibraryConfig;
  address: string;
  activeRev: string | null;
}) {
  const t = useTranslations("evidenceLibraryMock.admin");
  const menu = [
    t("menu.overview"),
    t("menu.records"),
    t("menu.files"),
    t("menu.imports"),
    t("menu.zotero"),
    t("menu.collections"),
    t("menu.settings"),
  ];
  const rows = [
    { title: t("row1"), meta: t("row1Meta"), state: t("review") },
    { title: t("row2"), meta: t("row2Meta"), state: t("published") },
    { title: t("row3"), meta: t("row3Meta"), state: t("review") },
  ];
  const stats = [
    { value: "1,284", label: t("statPublished") },
    { value: "37", label: t("statWaiting") },
    { value: t("statSyncValue"), label: t("statSync") },
  ];
  return (
    <BrowserFrame url={`https://${address}/admin?code=••••••••••••`}>
      <SiteNav
        config={config}
        title={`${config.name} · ${t("adminSuffix")}`}
        links={[t("signedInAs")]}
      />
      <div className="grid sm:grid-cols-[160px_1fr]">
        <nav className="hidden border-r bg-muted/30 p-2 text-xs sm:block">
          {menu.map((item, i) => (
            <div
              key={item}
              className={
                i === 0
                  ? "rounded-md bg-background px-2 py-1.5 font-medium shadow-xs"
                  : "px-2 py-1.5 text-muted-foreground"
              }
            >
              {item}
            </div>
          ))}
        </nav>
        <div className="space-y-4 p-4">
          <div>
            <h3 className="text-base font-semibold">{t("welcome")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("welcomeHint", { rev: activeRev ?? "—" })}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-md border p-2">
                <p className="text-lg font-semibold">{stat.value}</p>
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
          <div className="divide-y rounded-md border text-xs">
            {rows.map((row) => (
              <div key={row.title} className="flex items-center justify-between gap-3 p-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.title}</p>
                  <p className="text-muted-foreground">{row.meta}</p>
                </div>
                <Tag color={config.secondary}>{row.state}</Tag>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
