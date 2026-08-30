/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
  planRuntimeImageOperationCleanup,
  requireProvisionedRuntimeImage,
} from "./runtimeImageMigration";

const COMMIT = "a".repeat(40);
const IMAGE = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"b".repeat(64)}`;

function operation(
  fields: Partial<Doc<"evidenceLibraryConfigOperations">>,
): Doc<"evidenceLibraryConfigOperations"> {
  return {
    _id: "r9700000000000000000000000000000",
    _creationTime: 1,
    libraryId: "r1700000000000000000000000000000",
    kind: "publish",
    idempotencyKey: "publish:test",
    status: "succeeded",
    stage: "completed",
    attemptCount: 1,
    requestedByClerkUserId: "user_test",
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  } as Doc<"evidenceLibraryConfigOperations">;
}

describe("runtime image data migration", () => {
  it("removes only unverifiable release recovery data from a terminal operation", () => {
    const row = operation({
      runtimeUpdate: { from: "c".repeat(40), to: COMMIT },
      configurationDeploymentTarget: {
        applicationId: "app-1",
        aiProviderKey: { present: false },
        runtimeBindingId:
          "rs700000000000000000000000000000" as Id<"evidenceLibraryRuntimeBindings">,
        targetBaseUrl: "https://library.example.test",
        customDomains: [],
        revisionKey: "r2",
        defaultLocale: "en-GB",
        runtimeCommit: COMMIT,
        encryptedRuntimeConfig: "encrypted",
        runtimeConfigSha256: "d".repeat(64),
        savedAt: 1,
      },
      receipt: {
        revisionKey: "r2",
        runtimeCommit: COMMIT,
        targetConfigSha256: "d".repeat(64),
        activatedAt: 1,
      },
    });

    expect(planRuntimeImageOperationCleanup(row)).toEqual({
      configurationDeploymentTarget: undefined,
      runtimeUpdate: undefined,
      receipt: {
        revisionKey: "r2",
        targetConfigSha256: "d".repeat(64),
        activatedAt: 1,
      },
    });
  });

  it("does not rewrite a complete exact pair", () => {
    expect(
      planRuntimeImageOperationCleanup(
        operation({
          runtimeUpdate: {
            from: COMMIT,
            to: COMMIT,
            fromImage: IMAGE,
            toImage: IMAGE,
          },
          receipt: { runtimeCommit: COMMIT, runtimeImage: IMAGE },
        }),
      ),
    ).toBeNull();
  });

  it("blocks active work instead of deleting its recovery target", () => {
    expect(() =>
      planRuntimeImageOperationCleanup(
        operation({
          status: "running",
          stage: "publishing",
          runtimeUpdate: { from: COMMIT, to: COMMIT },
        }),
      ),
    ).toThrow(/still active/);
  });

  it("allows an unassigned binding and rejects a provisioned binding without an image", () => {
    expect(() =>
      requireProvisionedRuntimeImage({
        _id: "rs700000000000000000000000000000",
        _creationTime: 1,
        libraryId: "r1700000000000000000000000000000",
        state: "pending",
        targetBaseUrl: "https://library.example.test",
        createdAt: 1,
        updatedAt: 1,
      } as Doc<"evidenceLibraryRuntimeBindings">),
    ).not.toThrow();
    expect(() =>
      requireProvisionedRuntimeImage({
        _id: "rs700000000000000000000000000000",
        _creationTime: 1,
        libraryId: "r1700000000000000000000000000000",
        state: "ready",
        targetBaseUrl: "https://library.example.test",
        targetRuntimeId: "app-1",
        runtimeCommit: COMMIT,
        createdAt: 1,
        updatedAt: 1,
      } as Doc<"evidenceLibraryRuntimeBindings">),
    ).toThrow(/without an exact release pair/);
  });
});
