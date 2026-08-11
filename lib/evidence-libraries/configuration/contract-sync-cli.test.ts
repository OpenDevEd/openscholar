import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);

test("mutating contract sync requires an explicit artifact commit", async () => {
  await expect(
    execFileAsync(
      "node",
      [
        "scripts/sync-evidence-library-config-contract.mjs",
        "--source-root",
        "/definitely/missing",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    ),
  ).rejects.toMatchObject({
    stderr: expect.stringMatching(/--commit.*required/i),
  });
});
