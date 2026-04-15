import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

describe("useQuery safety (CRASH-02)", () => {
  it("no bare destructuring of useQuery results without null/undefined guard", () => {
    // Pattern matches: const { foo } = useQuery(  or  const { foo, bar } = useQuery(
    // This is dangerous because useQuery can return undefined (loading) or null (not found)
    const result = execSync(
      'grep -rn "const {.*} = useQuery(" app/ components/ lib/ --include="*.tsx" --include="*.ts" || true',
      { encoding: "utf-8" },
    );
    expect(result.trim()).toBe("");
  });
});
