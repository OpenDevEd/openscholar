"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { useUser } from "@clerk/nextjs";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";

export function PostHogIdentify() {
  const { data: convexUser } = useOptionalAuthQuery(api.users.queries.me, {});
  const { user: clerkUser } = useUser();
  const syncProfile = useMutation(api.users.mutations.syncProfileFromSession);
  const lastIdentifiedRef = useRef<string | null>(null);
  const hasSyncedRef = useRef(false);

  const clerkHasProfile =
    clerkUser &&
    (clerkUser.primaryEmailAddress?.emailAddress ||
      clerkUser.firstName ||
      clerkUser.lastName);
  const convexHasEmptyProfile =
    convexUser && !convexUser.email && !convexUser.firstName && !convexUser.lastName;

  const effectiveProfile = convexUser
    ? {
        distinctId: convexUser.clerkId,
        email:
          convexHasEmptyProfile && clerkUser
            ? clerkUser.primaryEmailAddress?.emailAddress ?? undefined
            : convexUser.email || undefined,
        firstName:
          convexHasEmptyProfile && clerkUser
            ? clerkUser.firstName ?? undefined
            : convexUser.firstName ?? undefined,
        lastName:
          convexHasEmptyProfile && clerkUser
            ? clerkUser.lastName ?? undefined
            : convexUser.lastName ?? undefined,
        avatarUrl:
          convexHasEmptyProfile && clerkUser
            ? clerkUser.imageUrl ?? undefined
            : convexUser.avatarUrl ?? undefined,
        state: convexUser.state,
        lastLoginAt: convexUser.lastLoginAt,
        createdAt: convexUser.createdAt,
        updatedAt: convexUser.updatedAt,
      }
    : null;

  useEffect(() => {
    if (
      convexHasEmptyProfile &&
      clerkHasProfile &&
      clerkUser &&
      !hasSyncedRef.current
    ) {
      hasSyncedRef.current = true;
      void syncProfile({
        email: clerkUser.primaryEmailAddress?.emailAddress ?? undefined,
        firstName: clerkUser.firstName ?? undefined,
        lastName: clerkUser.lastName ?? undefined,
        avatarUrl: clerkUser.imageUrl ?? undefined,
      });
    }
  }, [convexHasEmptyProfile, clerkHasProfile, clerkUser, syncProfile]);

  useEffect(() => {
    if (effectiveProfile) {
      const signature = `${effectiveProfile.distinctId}|${effectiveProfile.email}|${effectiveProfile.updatedAt}`;
      if (lastIdentifiedRef.current !== signature) {
        const name =
          [effectiveProfile.firstName, effectiveProfile.lastName]
            .filter(Boolean)
            .join(" ") || undefined;
        const userPropertiesToSet: Record<string, string | number | undefined> = {
          email: effectiveProfile.email,
          name,
          first_name: effectiveProfile.firstName,
          last_name: effectiveProfile.lastName,
          avatar: effectiveProfile.avatarUrl,
          state: effectiveProfile.state,
          last_login_at: effectiveProfile.lastLoginAt,
          updated_at: effectiveProfile.updatedAt,
        };
        const userPropertiesToSetOnce: Record<string, number> = {
          created_at: effectiveProfile.createdAt,
        };
        posthog.identify(
          effectiveProfile.distinctId,
          Object.fromEntries(
            Object.entries(userPropertiesToSet).filter(([, v]) => v !== undefined)
          ) as Record<string, string | number>,
          userPropertiesToSetOnce
        );
        lastIdentifiedRef.current = signature;
      }
    } else if (lastIdentifiedRef.current !== null) {
      posthog.reset();
      lastIdentifiedRef.current = null;
      hasSyncedRef.current = false;
    }
  }, [effectiveProfile]);

  return null;
}
