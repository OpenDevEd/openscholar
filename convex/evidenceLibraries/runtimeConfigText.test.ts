import { expect, it } from "vitest";
import { runtimeConfigText } from "./runtimeConfiguration";

it("sends apostrophes as JSON escapes, which Coolify's build-time .env can hold, and parses to the same text", () => {
  const config = { footer: { disclaimer: "Records arrive without an editor's check." } };
  const text = runtimeConfigText(config);
  expect(text).not.toContain("'");
  expect(JSON.parse(text)).toEqual(config);
});
