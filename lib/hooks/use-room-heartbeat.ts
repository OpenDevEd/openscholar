"use client";

import { useEffect } from "react";
import { PRESENCE_HEARTBEAT_MS } from "@/lib/assistant/presence";

/**
 * Keeps the person in a presence room while `room` is set: a beat now, one every
 * PRESENCE_HEARTBEAT_MS, and leaving when it changes or the page goes. A tab that closes just stops
 * beating, and the room drops it after 2.5 beats. `beat` and `leave` are Convex mutations, which
 * keep their identity across renders.
 */
export function useRoomHeartbeat(room: string | null, beat: (sessionId: string) => Promise<string>, leave: (sessionToken: string) => Promise<unknown>) {
  // A timer and the room's session are the outside system.
  useEffect(() => {
    if (!room) return;
    const sessionId = crypto.randomUUID();
    let token: string | null = null;
    let left = false;
    const send = () =>
      beat(sessionId).then(
        (sessionToken) => {
          token = sessionToken;
          // The page left the room while this beat was on its way.
          if (left) leave(sessionToken).catch(() => {});
        },
        () => {},
      );
    void send();
    const timer = setInterval(send, PRESENCE_HEARTBEAT_MS);
    return () => {
      left = true;
      clearInterval(timer);
      if (token) leave(token).catch(() => {});
    };
    // \`beat\` and \`leave\` close over the room's own arguments, which \`room\` names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);
}
