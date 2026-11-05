"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { AuthorsIcon, ExploreIcon, Search, TopicsIcon, X } from "@/components/icons";
import { ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceRouter } from "@/lib/workspaces/href";

/** Explore's header: topics and authors are each at their own address, under one title and tabs that stay in place. */
export function useExploreHeader(list: "topics" | "authors") {
  const t = useTranslations("workspaces");
  const tTopics = useTranslations("topics");
  const router = useWorkspaceRouter();
  return {
    icon: ExploreIcon,
    title: t("explore"),
    tabs: <ListViewTabs label={t("explore")} value={list} onChange={next => { if (next !== list) router.push(`/${next}`); }} tabs={[
      {value: "topics", label: tTopics("title"), icon: <TopicsIcon aria-hidden className="size-3.5" />},
      {value: "authors", label: t("authors"), icon: <AuthorsIcon aria-hidden className="size-3.5" />},
    ]} />,
  };
}

/** The search at the top of an Explore card: what the page is for, so it takes the card's whole width. */
export function ExploreSearch({ label, placeholder, value, onChange, maxLength }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; maxLength?: number }) {
  const t = useTranslations("libraryPage");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="relative m-4">
      <Search aria-hidden className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={input} aria-label={label} placeholder={placeholder} maxLength={maxLength} className="h-11 border-transparent bg-inset ps-10 pe-11 shadow-none" value={value} onChange={event => onChange(event.target.value)} />
      {value && <Button type="button" variant="ghost" size="icon-sm" aria-label={t("clearSearch")} className="absolute end-1.5 top-1/2 -translate-y-1/2" onClick={() => {onChange(""); input.current?.focus();}}><X /></Button>}
    </div>
  );
}
