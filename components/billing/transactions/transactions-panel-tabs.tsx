"use client";

import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  presetForView,
  useTransactionsState,
  VIEW_TABS,
  type ViewTab,
} from "./use-transactions-state";

export function TransactionsPanelTabs() {
  const t = useTranslations("billingPage.transactions.tabs");
  const [state, setState] = useTransactionsState();

  return (
    <Tabs
      value={state.view}
      onValueChange={(v) => {
        const next = v as ViewTab;
        void setState({ view: next, ...presetForView(next) });
      }}
      data-transactions-tabs
      className="px-4 pt-3"
    >
      <TabsList className="h-8">
        {VIEW_TABS.map((tab) => (
          <TabsTrigger
            key={tab}
            value={tab}
            className="text-xs"
            data-transactions-tab={tab}
          >
            {t(tab)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
