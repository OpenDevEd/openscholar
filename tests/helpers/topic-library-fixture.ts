import type {MutationCtx} from "../../convex/_generated/server";
import {EVIDENCE_LIBRARY_CONFIG_PROVENANCE as provenance} from "../../lib/evidence-libraries/configuration/contract";
import {CURRENT_OWNER_CONFIGURATION_VERSION} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";

export async function seedTopicLibrary(ctx: MutationCtx, name: string, credentialDigest: string, url = "https://library.example.test", enabled = true) {
  const now = Date.now();
  const organizationId = await ctx.db.insert("organizations", {clerkOrganizationId: `org_${name}`, evidenceLibrariesEnabled: true, name, slug: name, state: "active", clerkCreatedAt: now, clerkUpdatedAt: now, createdAt: now, updatedAt: now});
  const libraryId = await ctx.db.insert("evidenceLibraries", {organizationId, name, slug: name, state: "active", createdByClerkUserId: "topic-test", updatedByClerkUserId: "topic-test", createdAt: now, updatedAt: now});
  const credentialId = await ctx.db.insert("evidenceLibraryCredentials", {libraryId, credentialKey: "library-service", credentialDigest, encryptedValue: "isolated-test-only", validationState: "valid", createdByClerkUserId: "topic-test", updatedByClerkUserId: "topic-test", createdAt: now, updatedAt: now});
  const revisionId = await ctx.db.insert("evidenceLibraryConfigRevisions", {libraryId, revisionKey: `${name}-r1`, revisionNumber: 1, basedOnRevisionId: null, rollbackOfRevisionId: null, ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION, contractProvenance: provenance, createdByClerkUserId: "topic-test", createdAt: now});
  const sectionId = await ctx.db.insert("evidenceLibraryConfigSections", {kind: "revision", libraryId, revisionId, sectionKey: "topics", payload: {enabled}, payloadByteLength: 16, contractProvenance: provenance, createdByClerkUserId: "topic-test", createdAt: now});
  const runtimeBindingId = await ctx.db.insert("evidenceLibraryRuntimeBindings", {libraryId, targetBaseUrl: url, state: "ready", targetRuntimeId: "isolated-test", runtimeCommit: provenance.commit, runtimeImage: "isolated-test", searchHost: "http://unused.invalid", searchIndex: "test", storageUrl: "http://unused.invalid", storagePrivateBucket: "private", storagePublicBucket: "public", storageMaxPdfBytes: 1, databaseCredentialId: credentialId, searchCredentialId: credentialId, storageCredentialId: credentialId, createdAt: now, updatedAt: now});
  const operationId = await ctx.db.insert("evidenceLibraryConfigOperations", {libraryId, kind: "publish", idempotencyKey: `${name}-r1`, revisionId, status: "succeeded", stage: "completed", attemptCount: 1, requestedByClerkUserId: "topic-test", receipt: {revisionKey: `${name}-r1`, runtimeReceiptId: "isolated-test", activatedAt: now}, createdAt: now, updatedAt: now});
  await ctx.db.patch("evidenceLibraries", libraryId, {activeRevisionId: revisionId, activeDeploymentOperationId: operationId, runtimeBindingId});
  return {libraryId, sectionId, revisionId, credentialId};
}
