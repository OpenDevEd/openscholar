import { describe, expect, it, vi } from "vitest";
import { deleteLibraryDatabase } from "./databaseSetupClient";

const provisionerUrl = "https://database-provisioner.example.test";
const token = "database-provisioner-token";
const libraryId = "j575gwm9tffaeghzu0rwqc9g196b09zb";

describe("Evidence Library database provisioner client", () => {
  it("sends only the library ID and accepts an idempotent deletion receipt", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(
        "/v1/library-databases/delete",
      );
      expect(init).toMatchObject({
        method: "POST",
        body: JSON.stringify({ libraryId }),
      });
      return new Response(
        JSON.stringify({
          libraryId,
          outcome: "deleted",
          databaseName: "el_123",
          loginName: "el_123_user",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await expect(
      deleteLibraryDatabase({
        fetchImpl,
        libraryId,
        provisionerUrl,
        token,
      }),
    ).resolves.toEqual({
      outcome: "deleted",
      databaseName: "el_123",
      loginName: "el_123_user",
    });
  });

  it("rejects a receipt for another library", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            libraryId: "another-library",
            outcome: "deleted",
            databaseName: "el_123",
            loginName: "el_123_user",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    await expect(
      deleteLibraryDatabase({
        fetchImpl,
        libraryId,
        provisionerUrl,
        token,
      }),
    ).rejects.toMatchObject({ code: "DATABASE_PROVISIONER_INVALID_RESPONSE" });
  });
});
