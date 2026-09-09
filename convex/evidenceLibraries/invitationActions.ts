"use node";

import { v } from "convex/values";
import nodemailer from "nodemailer";
import { z } from "zod";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { optionalPlatformMailService, requireRuntimeEnvironment } from "./runtimeActionConfig";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";

export const invite = action({
  args: { libraryId: v.id("evidenceLibraries"), email: v.string(), role: v.union(v.literal("editor"), v.literal("creator")) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const mail = optionalPlatformMailService(message => new Error(message));
    if (!mail) throw createError("VALIDATION_ERROR", "Invitation email is not configured");
    const origin = requireAppUrl();
    const invitationId = await ctx.runMutation(internal.evidenceLibraries.invitations.prepare, args);
    const invitation = await ctx.runQuery(internal.evidenceLibraries.invitations.readDelivery, { invitationId });
    if (!invitation) throw createError("CONFLICT", "Invitation is no longer available");
    const transport = nodemailer.createTransport({
      host: mail.host, port: mail.port, secure: mail.security === "tls",
      requireTLS: mail.security === "starttls", ignoreTLS: mail.security === "none",
      connectionTimeout: 10_000, socketTimeout: 20_000,
      ...(mail.username ? { auth: { user: mail.username, pass: mail.password } } : {}),
    });
    try {
      await transport.sendMail({
        from: mail.from, to: invitation.email,
        subject: `Invitation to ${invitation.libraryName}`,
        text: `You have been invited to ${invitation.libraryName} with the ${invitation.role} role.\n\nSign in with ${invitation.email} and accept the invitation:\n${new URL("/evidence-libraries", origin)}\n\nThis invitation expires in seven days. It grants access to this library only.`,
      });
    } catch (error) {
      console.error("Library invitation email failed", { invitationId, error });
      await ctx.runMutation(internal.evidenceLibraries.invitations.recordDelivery, { invitationId, delivery: "failed" });
      throw createError("VALIDATION_ERROR", "The invitation email could not be sent. Try again.");
    } finally { transport.close(); }
    await ctx.runMutation(internal.evidenceLibraries.invitations.recordDelivery, { invitationId, delivery: "sent" });
    return null;
  },
});

export const respond = action({
  args: { invitationId: v.id("evidenceLibraryInvitations"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw createError("UNAUTHENTICATED", "Sign in to respond");
    const key = requireRuntimeEnvironment("CLERK_SECRET_KEY", message => new Error(message));
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("Invitation account verification failed", { status: response.status, clerkUserId: identity.subject });
      throw createError("VALIDATION_ERROR", "Unable to verify your account. Try again.");
    }
    const user = z.object({ email_addresses: z.array(z.object({
      email_address: z.string(), verification: z.object({ status: z.string() }).nullable(),
    })) }).parse(await response.json());
    const emails = user.email_addresses.filter(address => address.verification?.status === "verified").map(address => address.email_address.toLowerCase());
    return await ctx.runMutation(internal.evidenceLibraries.invitations.respondVerified, { ...args, emails });
  },
});
