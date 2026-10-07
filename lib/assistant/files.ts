/**
 * What can be attached to an assistant chat (#647), shared by the composer and the server.
 * Images go to the model with the message. Uploads an hour come from the person's plan
 * (lib/billing/plans.ts `uploads_per_hour`).
 */

/** Files one message can carry. */
export const MAX_FILES_PER_MESSAGE = 10;
/** Files a person can have attached and not yet sent, across their chats. */
export const MAX_PENDING_FILES = 20;
/** The largest image a person can pick, before the composer shrinks it. */
export const MAX_IMAGE_MB = 20;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
/** The longest a file's name is kept. */
export const MAX_FILE_NAME = 200;
/**
 * The size the composer shrinks an image to: Claude's own ceiling, past which the model
 * scales it down anyway and only waits longer (platform.claude.com, Vision).
 */
export const IMAGE_EDGE = 1568;
export const IMAGE_PIXELS = 1_150_000;
/** A file no reply has read for this long is deleted, and its chat says so. */
export const FILE_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** A file attached and never sent is deleted after this long. */
export const PENDING_FILE_MS = 24 * 60 * 60 * 1000;

/** Whether a model takes images, from its OpenRouter input types (models.inputModalities). */
export const readsImages = (inputs: readonly string[] | undefined) => inputs?.includes("image") ?? false;
