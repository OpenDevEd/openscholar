import { describe, expect, it } from "vitest";
import { retryOnConflict } from "./retryOnConflict";

const conflict = () => new Error('{"code":"OptimisticConcurrencyControlFailure","message":"Documents read from or written to the \\"counters\\" table changed"}');
const noWait = async () => {};

describe("retryOnConflict", () => {
  it("runs a write again after a write conflict, until it succeeds", async () => {
    let calls = 0;
    const result = await retryOnConflict(async () => { calls++; if (calls < 3) throw conflict(); return "done"; }, 5, noWait);
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt with the conflict", async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw conflict(); }, 4, noWait)).rejects.toThrow(/OptimisticConcurrencyControlFailure/);
    expect(calls).toBe(4);
  });

  it("never runs a write again for any other error", async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw new Error("Paper not found"); }, 5, noWait)).rejects.toThrow("Paper not found");
    expect(calls).toBe(1);
  });
});
