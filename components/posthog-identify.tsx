"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { api } from "@/convex/_generated/api";

/**
 * Syncs PostHog distinct_id with the authenticated user and sets person properties.
 * Uses Convex users.me when available; falls back to WorkOS session when Convex user
 * has empty profile (WorkOS JWT may omit email/name claims).
 * Also syncs profile from WorkOS session to Convex when Convex has empty data.
 */
export function PostHogIdentify() {
  const convexUser = useQuery(api.users.queries.me);
  const workosUser = useAuth().user;
  const syncProfile = useMutation(api.users.mutations.syncProfileFromSession);
  const lastIdentifiedRef = useRef<string | null>(null);
  const hasSyncedRef = useRef(false);

  const workosHasProfile =
    workosUser &&
    (workosUser.email || workosUser.firstName || workosUser.lastName);
  const convexHasEmptyProfile =
    convexUser && !convexUser.email && !convexUser.firstName && !convexUser.lastName;
  const effectiveProfile = convexHasEmptyProfile && workosHasProfile
    ? {
        distinctId: convexUser.workosId,
        email: workosUser.email ?? undefined,
        firstName: workosUser.firstName ?? undefined,
        lastName: workosUser.lastName ?? undefined,
        avatarUrl: workosUser.profilePictureUrl ?? undefined,
        state: convexUser.state,
        lastLoginAt: convexUser.lastLoginAt,
        createdAt: convexUser.createdAt,
        updatedAt: convexUser.updatedAt,
      }
    : convexUser
      ? {
          distinctId: convexUser.workosId,
          email: convexUser.email || undefined,
          firstName: convexUser.firstName ?? undefined,
          lastName: convexUser.lastName ?? undefined,
          avatarUrl: convexUser.avatarUrl ?? undefined,
          state: convexUser.state,
          lastLoginAt: convexUser.lastLoginAt,
          createdAt: convexUser.createdAt,
          updatedAt: convexUser.updatedAt,
        }
      : null;

  // Sync Convex user from WorkOS session when Convex has empty profile
  useEffect(() => {
    if (
      convexHasEmptyProfile &&
      workosHasProfile &&
      workosUser &&
      !hasSyncedRef.current
    ) {
      hasSyncedRef.current = true;
      void syncProfile({
        email: workosUser.email ?? undefined,
        firstName: workosUser.firstName ?? undefined,
        lastName: workosUser.lastName ?? undefined,
        avatarUrl: workosUser.profilePictureUrl ?? undefined,
      });
    }
  }, [convexHasEmptyProfile, workosHasProfile, workosUser, syncProfile]);

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
