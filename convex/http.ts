import { catalog as topicCatalog, detail as topicDetail, associations as topicAssociations } from "./topics/serviceHttp";
import { generate as generateLibraryDigest } from "./evidenceLibraries/digests/service";
import { replacePublicationAssociations, authorProfileCatalog } from "./authors/serviceHttp";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeWebhook } from "./billing/stripeWebhook";
import { autumnWebhook } from "./billing/autumnWebhook";
import { clerkWebhook } from "./webhooks/clerk";
import { checkAdminSession, checkReaderStatus, handOff, noteReaderSeen } from "./evidenceLibraries/serviceHttp";
import { receiveSourceStatus } from "./evidenceLibraries/sourceStatus";
import { readCollectionItems } from "./evidenceLibraries/collectionSources";
import { COLLECTION_INVITATION_CALLS, serveCollectionInvitations } from "./evidenceLibraries/collectionInvitations";
import { download as downloadExport } from "./exports";
import { upload as uploadAssistantFile, uploadOptions as uploadAssistantFileOptions } from "./assistant/files";
import { requireAppUrl } from "./lib/env";
import { zoteroReturnUrl } from "./zotero/signInReturn";
import {
  handleChatCompletions,
  handleModelsV1,
  handleBalance,
  handleCors,
} from "./wallet/gateway/handler";

const http = httpRouter();
http.route({path: "/export", method: "GET", handler: downloadExport});
// Files attached to assistant chats: their bytes, sent with a one-time token (convex/assistant/files.ts).
http.route({path: "/assistant/upload", method: "POST", handler: uploadAssistantFile});
http.route({path: "/assistant/upload", method: "OPTIONS", handler: uploadAssistantFileOptions});
http.route({path: "/api/v1/evidence-libraries/topics/catalog", method: "POST", handler: topicCatalog});
http.route({path: "/api/v1/evidence-libraries/topics/detail", method: "POST", handler: topicDetail});
http.route({path: "/api/v1/evidence-libraries/topic-associations", method: "POST", handler: topicAssociations});
http.route({path: "/api/v1/evidence-libraries/digests/generate", method: "POST", handler: generateLibraryDigest});
http.route({path: "/api/v1/evidence-libraries/author-profiles", method: "POST", handler: authorProfileCatalog});
http.route({path: "/api/v1/evidence-libraries/source-collections/items", method: "POST", handler: readCollectionItems});
http.route({path: "/api/v1/evidence-libraries/author-associations", method: "POST", handler: replacePublicationAssociations});
// Clerk webhook for user sync
http.route({
  path: "/api/v1/evidence-libraries/admin-session/check",
  method: "POST",
  handler: checkAdminSession,
});

http.route({
  path: "/api/v1/evidence-libraries/reader-status",
  method: "POST",
  handler: checkReaderStatus,
});

http.route({
  path: "/api/v1/evidence-libraries/readers/seen",
  method: "POST",
  handler: noteReaderSeen,
});

http.route({
  path: "/api/v1/evidence-libraries/handoffs",
  method: "POST",
  handler: handOff,
});

// Invitations to a reader's collection in an Evidence Library, one route a call (./evidenceLibraries/collectionInvitations.ts).
for (const call of COLLECTION_INVITATION_CALLS) {
  http.route({ path: `/api/v1/evidence-libraries/collection-invitations/${call}`, method: "POST", handler: serveCollectionInvitations(call) });
}

http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: clerkWebhook,
});

http.route({
  path: "/api/v1/evidence-libraries/source-status",
  method: "POST",
  handler: receiveSourceStatus,
});

// Zotero sends the person here after they approve the key or not; they go back to the page they started on.
http.route({
  path: "/api/zotero/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const result = await ctx
      .runAction(internal.zotero.actions.completeOAuth, {
        oauthToken: url.searchParams.get("oauth_token") ?? undefined,
        oauthVerifier: url.searchParams.get("oauth_verifier") ?? undefined,
      })
      .catch((error: unknown) => {
        console.error("Zotero OAuth callback error:", error);
        return { returnTo: undefined, error: "failed" as const };
      });
    if (result.error) console.warn(`Zotero sign-in didn't finish: ${result.error}`);
    return Response.redirect(zoteroReturnUrl(requireAppUrl(), result), 302);
  }),
});

http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: stripeWebhook,
});

http.route({
  path: "/webhooks/autumn",
  method: "POST",
  handler: autumnWebhook,
});

// ─── Wallet AI Gateway (OpenAI-compatible) ──────────────────

http.route({
  path: "/api/wallet/v1/chat/completions",
  method: "POST",
  handler: handleChatCompletions,
});

http.route({
  path: "/api/wallet/v1/chat/completions",
  method: "OPTIONS",
  handler: handleCors,
});

http.route({
  path: "/api/wallet/v1/models",
  method: "GET",
  handler: handleModelsV1,
});

http.route({
  path: "/api/wallet/v1/models",
  method: "OPTIONS",
  handler: handleCors,
});

http.route({
  path: "/api/wallet/balance",
  method: "GET",
  handler: handleBalance,
});

http.route({
  path: "/api/wallet/balance",
  method: "OPTIONS",
  handler: handleCors,
});

export default http;
