// Which links stay in the organization a page is in (#651).
import { describe, expect, it } from "vitest";
import { workspaceHref } from "@/lib/workspaces/href";

describe("workspaceHref", () => {
  it("puts a workspace's sections, its settings and home under the organization", () => {
    expect(workspaceHref("lab", "/library?sort=rating")).toBe("/o/lab/library?sort=rating");
    expect(workspaceHref("lab", "/settings")).toBe("/o/lab/settings");
    expect(workspaceHref("lab", "/settings/workspace/members")).toBe("/o/lab/settings/workspace/members");
    // Its plans (#652).
    expect(workspaceHref("lab", "/pricing")).toBe("/o/lab/pricing");
    expect(workspaceHref("lab", "/")).toBe("/o/lab");
  });

  it("keeps the deployment's admin pages in the organization, and leaves other pages and your own workspace as they are", () => {
    expect(workspaceHref("lab", "/settings/admin/models")).toBe("/o/lab/settings/admin/models");
    expect(workspaceHref("lab", "/settingsx")).toBe("/settingsx");
    expect(workspaceHref(undefined, "/settings")).toBe("/settings");
  });
});
