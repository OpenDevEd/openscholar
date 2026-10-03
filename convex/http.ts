import { catalog as topicCatalog, detail as topicDetail, associations as topicAssociations } from "./topics/serviceHttp";
import { generate as generateLibraryDigest } from "./evidenceLibraries/digests/service";
import { replacePublicationAssociations, authorProfileCatalog } from "./authors/serviceHttp";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeWebhook } from "./billing/stripeWebhook";
import { autumnWebhook } from "./billing/autumnWebhook";
import { clerkWebhook } from "./webhooks/clerk";
import { checkAdminSession, checkReaderStatus } from "./evidenceLibraries/serviceHttp";
import { receiveSourceStatus } from "./evidenceLibraries/sourceStatus";
import { readCollectionItems } from "./evidenceLibraries/collectionSources";
import { download as downloadLibraryExport } from "./library/exports";
import { requireAppUrl } from "./lib/env";
import {
  handleChatCompletions,
  handleModelsV1,
  handleBalance,
  handleCors,
} from "./wallet/gateway/handler";

const http = httpRouter();
http.route({path: "/library/export", method: "GET", handler: downloadLibraryExport});
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
  path: "/webhooks/clerk",
  method: "POST",
  handler: clerkWebhook,
});

http.route({
  path: "/api/v1/evidence-libraries/source-status",
  method: "POST",
  handler: receiveSourceStatus,
});

// Zotero OAuth callback
http.route({
  path: "/api/zotero/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const oauthToken = url.searchParams.get("oauth_token");
    const oauthVerifier = url.searchParams.get("oauth_verifier");

    if (!oauthToken || !oauthVerifier) {
      return new Response("Missing OAuth parameters", { status: 400 });
    }

    const frontendUrl = requireAppUrl();
    try {
      const result = await ctx.runAction(internal.zotero.actions.completeOAuth, {
        oauthToken,
        oauthVerifier,
      });

      if (!result.success) {
        return Response.redirect(
          `${frontendUrl}/?zotero_error=${encodeURIComponent(result.error || "Unknown error")}`,
          302,
        );
      }

      const returnPath = result.returnTo ?? "/";
      const separator = returnPath.includes("?") ? "&" : "?";
      return Response.redirect(
        `${frontendUrl}${returnPath}${separator}zotero_connected=true`,
        302,
      );
    } catch (error) {
      console.error("Zotero OAuth callback error:", error);
      return Response.redirect(
        `${frontendUrl}/?zotero_error=${encodeURIComponent("OAuth failed")}`,
        302,
      );
    }
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
