"use node";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { authorContentFields } from "./validators";
import { checkEvidenceLibraryUploadContent } from "../../lib/evidence-libraries/configuration/uploads";
import { createError } from "../lib/errors";
import type { Id } from "../_generated/dataModel";

export const save = action({
  args: {profileId: v.id("authorProfiles"), expectedRevision: v.number(), content: v.object(authorContentFields), photo: v.optional(v.string()), featured: v.optional(v.array(v.id("authorPublications")))},
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const previous = await ctx.runQuery(internal.authors.profiles.editable, {profileId: args.profileId});
    let photoId: Id<"_storage"> | undefined;
    if (args.photo) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(args.photo);
      if (!match || args.photo.length > 670000) throw createError("VALIDATION_ERROR", "Choose a PNG, JPEG or WebP under 500 KB");
      const bytes = Buffer.from(match[2], "base64");
      const extension = match[1] === "image/jpeg" ? "jpg" : match[1].slice(6);
      const checked = checkEvidenceLibraryUploadContent({kind: "shareImage", name: `photo.${extension}`, content: bytes});
      if (!checked.ok || bytes.length > 500000) throw createError("VALIDATION_ERROR", "Choose a PNG, JPEG or WebP under 500 KB");
      photoId = await ctx.storage.store(new Blob([bytes], {type: match[1]}));
    }
    let revision: number;
    try {
      revision = await ctx.runMutation(internal.authors.profiles.saveWithPhoto, {
        profileId: args.profileId, expectedRevision: args.expectedRevision, content: args.content, featured: args.featured,
        ...(args.photo !== undefined ? {photo: {storageId: photoId}} : {}),
      });

    } catch (error) {
      if (photoId) await ctx.storage.delete(photoId);
      throw error;
    }
    if (args.photo !== undefined && previous.photoId) {
      await ctx.storage.delete(previous.photoId).catch(error => console.error("Old author photo cleanup failed", {profileId: args.profileId, storageId: previous.photoId, error}));
    }
    return revision;
  },
});
