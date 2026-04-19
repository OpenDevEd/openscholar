"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import {
  ChevronLeftIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClearConversationDialog } from "./clear-conversation";
import type { Doc } from "@/convex/_generated/dataModel";

interface ChatHeaderProps {
  job: Doc<"extractionJobs">;
  threadId: string;
}

export function ChatHeader({ job, threadId }: ChatHeaderProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [clearOpen, setClearOpen] = useState(false);
  const isGenerating = job.isGenerating ?? false;

  return (
    <>
      <header
        className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
        data-chat-header="true"
      >
        <motion.nav
          aria-label="Breadcrumb"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/extraction"
                aria-label={t("chatBack")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-action="back"
              >
                <ChevronLeftIcon className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("chatBack")}</TooltipContent>
          </Tooltip>
          <Link
            href="/extraction"
            className="hidden truncate transition-colors hover:text-foreground sm:inline"
          >
            {tc("extraction")}
          </Link>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <h1
            className="min-w-0 truncate text-sm font-medium text-foreground"
            data-testid="chat-job-name"
          >
            {job.name}
          </h1>
        </motion.nav>

        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("chatHeaderMore")}
                    className="size-8"
                    data-action="header-menu"
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("chatHeaderMore")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuItem
                variant="destructive"
                disabled={isGenerating}
                onSelect={(e) => {
                  e.preventDefault();
                  if (isGenerating) return;
                  setClearOpen(true);
                }}
                data-action="open-clear"
              >
                <Trash2Icon className="size-4" />
                <span>{t("chatClearTitle").replace(/\?$/, "")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ClearConversationDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        threadId={threadId}
      />
    </>
  );
}
