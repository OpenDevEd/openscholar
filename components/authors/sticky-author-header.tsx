"use client";

import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Pencil } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { AuthorProfile } from "./types";

export function StickyAuthorHeader({
  profile,
  headerRef,
  onEdit,
}: {
  profile: AuthorProfile;
  headerRef: RefObject<HTMLElement | null>;
  onEdit?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    // Observe the real scroll boundary, including the app's nested scroll area.
    let parent = header.parentElement;
    while (
      parent &&
      !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)
    ) {
      parent = parent.parentElement;
    }
    const root =
      parent === document.body || parent === document.documentElement
        ? null
        : parent;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const top = root?.getBoundingClientRect().top ?? 0;
        setCollapsed(
          !entry.isIntersecting && entry.boundingClientRect.bottom <= top + 20,
        );
      },
      { root, rootMargin: "-20px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, [headerRef]);

  return (
    <div className="pointer-events-none sticky top-3 z-30 !m-0 h-0">
      <AnimatePresence initial={false}>
        {collapsed && (
          <motion.div
            key="compact-author"
            initial={{
              opacity: 0,
              y: reduceMotion ? 0 : -14,
              scale: reduceMotion ? 1 : 0.985,
            }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: reduceMotion ? 0 : -10,
              scale: reduceMotion ? 1 : 0.99,
            }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    type: "spring",
                    stiffness: 420,
                    damping: 36,
                    mass: 0.8,
                    opacity: { duration: 0.18 },
                  }
            }
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/70 bg-background/90 px-3 py-2.5 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:px-4"
          >
            <Avatar className="size-9 shrink-0 rounded-lg border border-border/50">
              <AvatarImage
                src={profile.photo}
                alt=""
                className="object-cover"
              />
              <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {profile.name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{profile.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {profile.affiliation || profile.headline}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to author profile"
              onClick={() =>
                headerRef.current?.scrollIntoView({
                  behavior: reduceMotion ? "instant" : "smooth",
                  block: "start",
                })
              }
            >
              <ArrowUp className="size-4" />
            </Button>
            {onEdit && <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
              <span className="hidden sm:inline">Edit profile</span>
              <span className="sm:hidden">Edit</span>
            </Button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
