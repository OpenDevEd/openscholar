import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAction: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ getToken: mocks.getToken }),
}));
vi.mock("convex/nextjs", () => ({ fetchAction: mocks.fetchAction }));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      adminHandoffActions: { issueAdminHandoff: "issueAdminHandoff" },
    },
  },
}));

import { GET } from "@/app/evidence-libraries/[libraryId]/admin/route";

function request(query = "") {
  return new Request(
    `http://localhost:3012/evidence-libraries/lib_1/admin${query}`,
  );
}

function context(libraryId = "lib_1") {
  return { params: Promise.resolve({ libraryId }) };
}

describe("GET /evidence-libraries/[libraryId]/admin", () => {
  beforeEach(() => {
    mocks.fetchAction.mockReset();
    mocks.getToken.mockReset();
    mocks.getToken.mockResolvedValue("clerk-token");
  });

  it("sends the browser to the library with a real redirect", async () => {
    const launchUrl =
      "https://climate.example.test/api/admin/session?code=elc_1&return=%2Fadmin%2Fitems";
    mocks.fetchAction.mockResolvedValue({ status: "allowed", launchUrl });

    const response = await GET(request("?return=%2Fadmin%2Fitems"), context());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(launchUrl);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "issueAdminHandoff",
      { libraryId: "lib_1", returnPath: "/admin/items" },
      { token: "clerk-token" },
    );
  });

  it("does not forward a return path that could leave the library", async () => {
    mocks.fetchAction.mockResolvedValue({
      status: "allowed",
      launchUrl: "https://climate.example.test/api/admin/session?code=elc_1",
    });

    await GET(request("?return=https%3A%2F%2Fevil.example"), context());

    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "issueAdminHandoff",
      { libraryId: "lib_1", returnPath: undefined },
      { token: "clerk-token" },
    );
  });

  it.each([
    { status: "no_access", organisationName: "Climate Team" },
    { status: "not_ready", isOwner: true },
  ])("sends a refusal to the page that explains it", async (result) => {
    mocks.fetchAction.mockResolvedValue(result);

    const response = await GET(request("?return=%2Fadmin%2Fitems"), context());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/evidence-libraries/lib_1/admin/status?return=%2Fadmin%2Fitems",
    );
  });

  it("never asks for another code after the library reported a failure", async () => {
    const response = await GET(
      request("?error=invalid_code&return=%2Fadmin"),
      context(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/evidence-libraries/lib_1/admin/status?state=expired_link&return=%2Fadmin",
    );
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("asks an unknown visitor to sign in first", async () => {
    mocks.getToken.mockResolvedValue(null);

    const response = await GET(request("?return=%2Fadmin"), context());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/sign-in?redirect_url=%2Fevidence-libraries%2Flib_1%2Fadmin%3Freturn%3D%252Fadmin",
    );
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });
});
