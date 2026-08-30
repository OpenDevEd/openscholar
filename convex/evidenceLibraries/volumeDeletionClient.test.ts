import { describe, expect, it, vi } from "vitest";

import {
  deleteLibraryVolume,
  isRetryableVolumeDeletionError,
} from "./volumeDeletionClient";

const deleterUrl = "https://volume-deleter.example.test";
const token = "volume-deleter-token";
const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";

describe("Evidence Library volume deleter client", () => {
  it.each(["deleted", "absent"] as const)(
    "sends only the application UUID and accepts the %s receipt",
    async (outcome) => {
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        expect(url.origin).toBe(deleterUrl);
        expect(url.pathname).toBe("/v1/library-volumes/delete");
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({ applicationUuid }),
          redirect: "error",
        });
        return Response.json({ applicationUuid, outcome });
      });

      await expect(
        deleteLibraryVolume({ applicationUuid, deleterUrl, fetchImpl, token }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("treats an in-use volume as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            code: "volume_in_use",
            message: "provider detail is ignored",
          },
        },
        { status: 409 },
      ),
    );

    let error: unknown;
    try {
      await deleteLibraryVolume({
        applicationUuid,
        deleterUrl,
        fetchImpl,
        token,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "VOLUME_IN_USE",
      message: "The library runtime is still releasing its data volume",
    });
    expect(isRetryableVolumeDeletionError(error)).toBe(true);
  });

  it("treats an unreachable deleter as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("network detail");
    });

    let error: unknown;
    try {
      await deleteLibraryVolume({
        applicationUuid,
        deleterUrl,
        fetchImpl,
        token,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "VOLUME_DELETER_UNAVAILABLE" });
    expect(isRetryableVolumeDeletionError(error)).toBe(true);
  });

  it("rejects a receipt for another application", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        applicationUuid: "z1b2c3d4e5f6g7h8i9j0k1l2",
        outcome: "deleted",
      }),
    );

    await expect(
      deleteLibraryVolume({ applicationUuid, deleterUrl, fetchImpl, token }),
    ).rejects.toMatchObject({ code: "VOLUME_DELETER_INVALID_RESPONSE" });
  });
});
