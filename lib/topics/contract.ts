import { z } from "zod";

export const topicIdSchema = z.string().regex(/^T[1-9]\d*$/);
export const topicNodeIdSchema = z.string().regex(/^(?:T[1-9]\d*|(?:domains|fields|subfields)\/[1-9]\d*)$/);
export const topicNodeSchema = z.object({
  id: topicNodeIdSchema, name: z.string().min(1).max(1000),
  parent: topicNodeIdSchema.nullable(),
  level: z.enum(["domain", "field", "subfield", "topic"]),
  path: z.array(z.string().max(1000)).max(4), childCount: z.number().int().nonnegative(),
}).strict();
export type TopicNode = z.infer<typeof topicNodeSchema>;
const envelope = {contractVersion: z.literal(1), libraryId: z.string().min(1).max(128)};
export const topicCatalogRequestSchema = z.object({
  ...envelope, parent: topicNodeIdSchema.nullable().optional(), query: z.string().max(200).optional(),
  ids: z.array(topicNodeIdSchema).max(100).optional(), cursor: z.string().max(8192).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(100),
}).strict().refine(value => [value.parent !== undefined, value.query !== undefined, value.ids !== undefined].filter(Boolean).length === 1, "Choose one catalog operation");
export const topicCatalogResponseSchema = z.object({
  contractVersion: z.literal(1), nodes: z.array(topicNodeSchema).max(100), revision: z.string(),
  nextCursor: z.string().nullable(), publicBaseUrl: z.string().url(),
}).strict();
export const topicDetailRequestSchema = z.object({...envelope, topicId: topicIdSchema}).strict();
export const topicDetailResponseSchema = z.object({
  contractVersion: z.literal(1), id: topicIdSchema, name: z.string(), description: z.string(),
  keywords: z.array(z.string()), path: z.array(z.object({id: topicNodeIdSchema, name: z.string()}).strict()).max(4),
  worksCount: z.number().int().nonnegative(), fetchedAt: z.string().datetime(), revision: z.string(),
  topicUrl: z.string().url(), publicBaseUrl: z.string().url(),
}).strict();
export const topicAssociationRequestSchema = z.object({
  ...envelope, idempotencyKey: z.string().min(1).max(200), itemKey: z.string().regex(/^[A-Z0-9]{8}$/),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  publishedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["published", "unpublished"]), topicIds: z.array(topicIdSchema).max(100),
  openalexId: z.string().regex(/^W[1-9]\d*$/).nullable(), doi: z.string().max(2048).nullable(),
  metadata: z.object({title: z.string().max(10000), date: z.string().max(500).nullable(),
    itemType: z.string().max(100), creators: z.array(z.string().max(1000)).max(1000),
    abstract: z.string().max(100000).nullable(),
  }).strict().nullable(),
}).strict().refine(value => value.state === "published" ? value.metadata !== null : value.topicIds.length === 0, "Invalid publication state");
export type TopicAssociationRequest = z.infer<typeof topicAssociationRequestSchema>;
export const topicAssociationReceiptSchema = z.object({
  contractVersion: z.literal(1), idempotencyKey: z.string(), generation: z.number().int().positive(),
  status: z.enum(["applied", "superseded"]),
}).strict();
