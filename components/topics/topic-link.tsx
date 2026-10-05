"use client";

import { useContext } from "react";
import Link from "next/link";
import { FocusModeClose } from "@/components/focus-mode/close-context";
import { topicHref } from "@/lib/topics/links";
import { useUIStore } from "@/lib/store";

/** Keep navigation inside a clickable paper card from also opening focus mode. */
export function TopicLink({ topic, className = "" }: {
  topic: { id: string; display_name: string };
  className?: string;
}) {
  // In focus mode, going to a topic closes it, whichever focus mode it is.
  const closeFocus = useContext(FocusModeClose);
  return <Link
    href={topicHref(topic.id, topic.display_name)}
    className={`rounded-sm hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring ${className}`}
    onClick={event => event.stopPropagation()}
    onNavigate={() => (closeFocus ? closeFocus() : useUIStore.getState().setIsFocusModeOpen(false))}
  >{topic.display_name}</Link>;
}
