"use client";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  >
    {(context) => (
      <>
        {typeof children === "function" ? children(context) : children}
        <PinToBottomBeforePaint />
      </>
    )}
  </StickToBottom>
);

/**
 * use-stick-to-bottom follows growing content one animation frame late, so
 * every growth step (streamed text, a panel opening) paints once too low and
 * then snaps back. ResizeObserver callbacks run before paint, so pinning
 * there keeps the view still. The scroller is watched too: when it grows (the
 * composer below it shrinking), the browser moves the view up a pixel a frame,
 * which the library takes for the person scrolling up and stops following.
 * Recording it as a resize marks that move as the library's own.
 */
const PinToBottomBeforePaint = () => {
  const { contentRef, scrollRef, state } = useStickToBottomContext();
  // Outside system: a ResizeObserver on the conversation content and its scroller.
  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) {
      return;
    }
    let scrollerHeight = scroller.clientHeight;
    const observer = new ResizeObserver((entries) => {
      if (!state.isAtBottom || state.escapedFromLock) {
        scrollerHeight = scroller.clientHeight;
        return;
      }
      // A scroller resize is recorded as the library records a content resize, whichever of it and the
      // scroll event it causes comes first, so the scroll isn't taken for the person's.
      if (entries.some((entry) => entry.target === scroller)) {
        const difference = scroller.clientHeight - scrollerHeight;
        scrollerHeight = scroller.clientHeight;
        if (difference) {
          state.resizeDifference = difference;
          requestAnimationFrame(() => setTimeout(() => {
            if (state.resizeDifference === difference) state.resizeDifference = 0;
          }, 1));
        }
      }
      state.scrollTop = state.calculatedTargetScrollTop;
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [contentRef, scrollRef, state]);
  return null;
};

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);
