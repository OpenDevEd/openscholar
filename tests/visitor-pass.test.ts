import { describe, expect, it, vi } from "vitest";
import { withPass } from "@/lib/visitor-pass";

const challenged = () => new Response("<html>challenge</html>", { status: 403, headers: { "cf-mitigated": "challenge" } });
const answered = () => new Response("ok");

describe("a request Cloudflare challenges", () => {
  it("goes again once the browser has earned its pass", async () => {
    const plain = vi.fn().mockResolvedValueOnce(challenged()).mockResolvedValueOnce(answered());
    const earn = vi.fn().mockResolvedValue(undefined);
    const response = await withPass(plain, earn)("/results", { method: "POST", body: "[]" });
    expect(await response.text()).toBe("ok");
    expect(plain.mock.calls).toEqual([["/results", { method: "POST", body: "[]" }], ["/results", { method: "POST", body: "[]" }]]);
    expect(earn).toHaveBeenCalledTimes(1);
  });

  it("is sent twice at most, so a pass Cloudflare doesn't take never loops", async () => {
    const plain = vi.fn().mockImplementation(async () => challenged());
    const earn = vi.fn().mockResolvedValue(undefined);
    const response = await withPass(plain, earn)("/results", { method: "POST" });
    expect(response.status).toBe(403);
    expect(plain).toHaveBeenCalledTimes(2);
  });

  it("comes back as the challenge when the pass can't be earned", async () => {
    const plain = vi.fn().mockImplementation(async () => challenged());
    const response = await withPass(plain, () => Promise.reject(new Error("no")))("/results", { method: "POST" });
    expect(response.status).toBe(403);
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it("waits with the others challenged at the same time for one pass", async () => {
    let cleared = false;
    const plain = vi.fn().mockImplementation(async () => (cleared ? answered() : challenged()));
    const earn = vi.fn().mockImplementation(async () => { cleared = true; });
    const fetched = withPass(plain, earn);
    const responses = await Promise.all([fetched("/a", { method: "POST" }), fetched("/b", { method: "POST" })]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(earn).toHaveBeenCalledTimes(1);
  });

  it("is left alone when it can't be sent twice", async () => {
    const plain = vi.fn().mockImplementation(async () => challenged());
    const earn = vi.fn();
    const response = await withPass(plain, earn)(new Request("https://example.com/results", { method: "POST", body: "[]" }));
    expect(response.status).toBe(403);
    expect(earn).not.toHaveBeenCalled();
  });
});

it("a request Cloudflare answers is passed through untouched", async () => {
  const plain = vi.fn().mockResolvedValue(answered());
  const earn = vi.fn();
  const response = await withPass(plain, earn)("/results");
  expect(await response.text()).toBe("ok");
  expect(plain).toHaveBeenCalledTimes(1);
  expect(earn).not.toHaveBeenCalled();
});
