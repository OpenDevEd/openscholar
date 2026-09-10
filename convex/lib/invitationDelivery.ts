"use node";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { optionalPlatformMailService, requireRuntimeEnvironment } from "../evidenceLibraries/runtimeActionConfig";
import { createError } from "./errors";

export function requireInvitationMail() {
  const mail = optionalPlatformMailService(message => new Error(message));
  if (!mail) throw createError("VALIDATION_ERROR", "Invitation email is not configured");
  return mail;
}

export async function sendInvitationEmail(mail: ReturnType<typeof requireInvitationMail>, {senderName, senderEmail, ...message}: {senderName: string; senderEmail?: string | null; to: string; subject: string; text: string}) {
  const transport = nodemailer.createTransport({
    host: mail.host, port: mail.port, secure: mail.security === "tls",
    requireTLS: mail.security === "starttls", ignoreTLS: mail.security === "none",
    connectionTimeout: 10_000, socketTimeout: 20_000,
    ...(mail.username ? {auth: {user: mail.username, pass: mail.password}} : {}),
  });
  const address = senderEmail ?? mail.from;
  try { await transport.sendMail({from: {name: senderName, address}, replyTo: address, ...message}); }
  finally { transport.close(); }
}

export async function verifiedInvitationEmails(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw createError("UNAUTHENTICATED", "Sign in to respond");
  const key = requireRuntimeEnvironment("CLERK_SECRET_KEY", message => new Error(message));
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`, {
    headers: {Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error("Invitation account verification failed", {status: response.status, clerkUserId: identity.subject});
    throw createError("VALIDATION_ERROR", "Unable to verify your account. Try again.");
  }
  const user = z.object({email_addresses: z.array(z.object({
    email_address: z.string(), verification: z.object({status: z.string()}).nullable(),
  }))}).parse(await response.json());
  return user.email_addresses.filter(address => address.verification?.status === "verified").map(address => address.email_address.toLowerCase());
}
