import { v } from "convex/values";
import { MAX_APP_REDIRECT_URIS, capped } from "../lib/listCaps";

/** Where a developer app runs: a browser app is a public client; a server app is confidential and holds a secret. */
export const appKindValidator = v.union(v.literal("browser"), v.literal("server"));
/** The addresses Clerk may send people back to after they sign in to the app. */
export const redirectUrisValidator = capped(v.array(v.string()), MAX_APP_REDIRECT_URIS);
