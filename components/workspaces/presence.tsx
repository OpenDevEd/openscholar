"use client";

// Who else has an item open (#657), in its first row beside Activity: their photos, each ringed and
// rippling as a chat's members are while they're in it. An item's page keeps the person in its room
// while it's open; a list only reads who's in each. A person's own workspace is theirs alone, so
// it has none.

import { useMutation } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/components/settings/model-map";
import { PresentAvatar } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useRoomHeartbeat } from "@/lib/hooks/use-room-heartbeat";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import type { ItemKind } from "./activity";

/** Photos shown at once; the tooltip names everyone the room read gave. */
const SHOWN = 3;
/** People the room read names, for the tooltip. */
const NAMED = 8;

/** `join`: the item's own page, which puts the person in its room; a list leaves it off and only reads. */
export function ItemPresence({ kind, id, join = true }: { kind: ItemKind; id: string; join?: boolean }) {
  const t = useTranslations("workspaces.presence");
  const format = useFormatter();
  const workspaceId = useWorkspace();
  const org = useWorkspaceSlug() !== undefined;
  const heartbeat = useWorkspaceMutation(api.presence.heartbeat);
  const leave = useMutation(api.presence.leave);
  useRoomHeartbeat(join && org && workspaceId ? `${workspaceId}|${kind}:${id}` : null, (sessionId) => heartbeat({ kind, id, sessionId }), (sessionToken) => leave({ sessionToken }));
  const { data: here } = useProtectedQuery(api.presence.here, inWorkspace(org ? workspaceId : undefined, { kind, id, paginationOpts: { cursor: null, numItems: NAMED } }));
  const people = here?.page ?? [];
  // Named only when someone is there.
  const label = people.length ? t("hasOpen", { count: people.length, names: format.list(people.map((person) => person.name), { type: "conjunction" }) }) : "";
  // Each person arriving or leaving fades on their own. It sits where growing moves nothing else:
  // after a row's spacer, or first in a right-aligned group.
  const faces = (
    <span role="img" aria-label={people.length ? label : undefined} className="flex shrink-0 items-center -space-x-1.5">
      <AnimatePresence initial={false}>
        {people.slice(0, SHOWN).map((person) => (
          <motion.span key={person.userId} className="flex" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.3, ease: EASE }}>
            <PresentAvatar member={{ ...person, here: true }} />
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
  return people.length ? <TooltipHint label={label}>{faces}</TooltipHint> : faces;
}
