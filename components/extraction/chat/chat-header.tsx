"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
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
import { SourcesPanelSheet } from "./sources-panel";
import type { Doc } from "@/convex/_generated/dataModel";
import { ChatIcon } from "@/components/section-icons";

interface ChatHeaderProps {
  job: Doc<"extractionJobs">;
  threadId: string;
}

export function ChatHeader({ job, threadId }: ChatHeaderProps) {
  const t = useTranslations("extraction");
  const [clearOpen, setClearOpen] = useState(false);
  const isGenerating = job.isGenerating ?? false;

  return (
    <>
      {/* The shared page bar, fixed above the chat, which owns the scroll below it. */}
      <header
        className="@container shrink-0 border-b border-sidebar-border/50 px-4 sm:px-6"
        data-chat-header="true"
      >
        <PanelHeader
          icon={ChatIcon}
          title={job.name}
          backHref="/extraction"
          backLabel={t("chatBack")}
        >
          <SourcesPanelSheet jobId={job._id} />
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
        </PanelHeader>
      </header>

      <ClearConversationDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        threadId={threadId}
      />
    </>
  );
}
