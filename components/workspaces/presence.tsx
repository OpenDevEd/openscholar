"use client";

// Who else has an item open (#657), in its first row beside Activity: their photos, each ringed and
// rippling as a chat's members are while they're in it. An item's page keeps the person in its room
// while it's open; a list only reads who's in each. A person's own workspace is theirs alone, so
// it has none.

import { useMutation } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/assistant/sheets";
import { EASE } from "@/components/settings/model-map";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useRoomHeartbeat } from "@/lib/hooks/use-room-heartbeat";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import type { ItemKind } from "./activity";

/** Photos shown at once; the tooltip names everyone the room read gave. */
const SHOWN = 3;

/** `join`: the item's own page, which puts the person in its room; a list leaves it off and only reads. */
export function ItemPresence({ kind, id, join = true }: { kind: ItemKind; id: string; join?: boolean }) {
  const t = useTranslations("workspaces.presence");
  const format = useFormatter();
  const workspaceId = useWorkspace();
  const org = useWorkspaceSlug() !== undefined;
  const heartbeat = useWorkspaceMutation(api.presence.items.heartbeat);
  const leave = useMutation(api.presence.items.leave);
  useRoomHeartbeat(join && org && workspaceId ? `${workspaceId}|${kind}:${id}` : null, (sessionId) => heartbeat({ kind, id, sessionId }), (sessionToken) => leave({ sessionToken }));
  const { data: here } = useProtectedQuery(api.presence.items.here, inWorkspace(org ? workspaceId : undefined, { kind, id }));
  const people = here ?? [];
  const label = t("hasOpen", { count: people.length, names: format.list(people.map((person) => person.name), { type: "conjunction" }) });
  // Someone arriving or leaving fades, beside whatever else the row holds.
  return (
    <AnimatePresence initial={false}>
      {people.length ? (
        <motion.span key="here" className="flex shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
          <TooltipHint label={label}>
            <span role="img" aria-label={label} className="flex items-center -space-x-1.5">
              {people.slice(0, SHOWN).map((person) => (
                <Avatar key={person.userId} member={{ ...person, here: true }} />
              ))}
            </span>
          </TooltipHint>
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
