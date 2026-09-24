"use client";

import Link from "next/link";
import { topicHref } from "@/lib/topics/links";
import { useUIStore } from "@/lib/store";

/** Keep navigation inside a clickable paper card from also opening focus mode. */
export function TopicLink({ topic, className = "" }: {
  topic: { id: string; display_name: string };
  className?: string;
}) {
  return <Link
    href={topicHref(topic.id, topic.display_name)}
    className={`rounded-sm hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring ${className}`}
    onClick={event => event.stopPropagation()}
    onNavigate={() => useUIStore.getState().setIsFocusModeOpen(false)}
  >{topic.display_name}</Link>;
}
