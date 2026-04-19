"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDownIcon } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";

interface JumpToLatestPillProps {
  /** Total messages currently in the thread. Used to count unread arrivals. */
  messageCount: number;
}

/**
 * Pill that appears at the bottom of the chat scroll area when the
 * user has scrolled away from the bottom. While streaming continues
 * and the user stays scrolled up, it accrues an "N new" badge so the
 * user knows what they're missing — Slack/Discord pattern. Resetting
 * happens the moment the user lands at the bottom (clicks the pill or
 * scrolls down manually).
 *
 * Must be rendered as a descendant of <StickToBottom> so the context
 * is available.
 */
export function JumpToLatestPill({ messageCount }: JumpToLatestPillProps) {
  const t = useTranslations("extraction");
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const reduceMotion = useReducedMotion();
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenCountRef = useRef(messageCount);

  // Track unread arrivals: anything that lands while the user is
  // scrolled up adds to the badge. When the user is at the bottom,
  // the lastSeen counter just trails the live count.
  useEffect(() => {
    if (isAtBottom) {
      setUnreadCount(0);
      lastSeenCountRef.current = messageCount;
      return;
    }
    const delta = messageCount - lastSeenCountRef.current;
    if (delta > 0) {
      setUnreadCount((c) => c + delta);
      lastSeenCountRef.current = messageCount;
    }
  }, [messageCount, isAtBottom]);

  const handleClick = () => {
    scrollToBottom();
    setUnreadCount(0);
  };

  const ariaLabel =
    unreadCount > 0
      ? `${t("chatJumpToLatestWithCount", { count: unreadCount })}`
      : t("chatJumpToLatest");

  return (
    <AnimatePresence>
      {!isAtBottom && (
        <motion.button
          type="button"
          onClick={handleClick}
          aria-label={ariaLabel}
          data-action="jump-to-latest"
          data-unread-count={unreadCount > 0 ? unreadCount : undefined}
          initial={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.85 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.85 }
          }
          transition={{ duration: 0.18, ease: "easeOut" }}
          whileHover={reduceMotion ? undefined : { y: -1 }}
          whileTap={reduceMotion ? undefined : { scale: 0.96 }}
          className={cn(
            "absolute bottom-4 left-1/2 z-10 -translate-x-1/2",
            "inline-flex items-center gap-2 rounded-full border bg-background/95 backdrop-blur",
            "px-3 py-1.5 text-xs font-medium text-foreground shadow-md",
            "hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <ArrowDownIcon className="size-3.5" />
          {unreadCount > 0 ? (
            <span data-testid="jump-pill-count">
              {t("chatJumpToLatestWithCount", { count: unreadCount })}
            </span>
          ) : (
            <span>{t("chatJumpToLatest")}</span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
