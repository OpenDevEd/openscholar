"use client";

import React, { useState } from "react";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/lib/hooks";
import { motion, AnimatePresence } from "motion/react";
import { subtleSpring } from "@/lib/animation-config";
import { FileText, ListFilter } from "@/components/icons";
import { useTranslations } from "next-intl";

type Direction = 1 | -1;

const slideVariants = {
  enter: (direction: Direction) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: Direction) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
  }),
};

interface SidebarLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarTabLabel?: string;
  contentTabLabel?: string;
}

export function SidebarLayout({
  sidebar,
  children,
  sidebarTabLabel,
  contentTabLabel,
}: SidebarLayoutProps) {
  const tc = useTranslations("common");
  const isMobile = useIsMobile();

  const [activeTab, setActiveTab] = useState<"content" | "sidebar">("content");
  const direction: Direction = activeTab === "sidebar" ? 1 : -1;

  if (isMobile) {
    return (
      <div className="flex flex-col flex-1 w-full h-full">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "content" | "sidebar")
          }
          className="flex flex-col flex-1 h-full gap-0"
        >
          {/* The app's segmented switch, not a filled bar. */}
          <div className="border-b bg-background p-2">
            <TabsList className="h-10 w-full">
              <TabsTrigger value="content">
                <FileText />
                {contentTabLabel ?? tc("results")}
              </TabsTrigger>
              <TabsTrigger value="sidebar">
                <ListFilter />
                {sidebarTabLabel ?? tc("filters")}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence
              initial={false}
              mode="popLayout"
              custom={direction}
            >
              {activeTab === "content" ? (
                <motion.div
                  key="content"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  {children}
                </motion.div>
              ) : (
                <motion.div
                  key="sidebar"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  {sidebar}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Tabs>
      </div>
    );
  }

  return <TwoColumnLayout leftColumn={sidebar} rightColumn={children} />;
}
