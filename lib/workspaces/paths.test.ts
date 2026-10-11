// The workspace address rules against the app's own pages, read from disk: a page added to one
// side only, or a rule that sends a switch to a page that isn't there, fails here and not in
// someone's browser.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { bareWorkspacePath, outsiderTarget, SECTIONS, switchTarget } from "./paths";

const APP = path.resolve(__dirname, "../../app");
const ORGANIZATION = path.join(APP, "o/[slug]");

/** Every route under `root` that has a page, as its folders: "" for the root's own page. */
function routes(root: string, at = ""): string[] {
  const entries = readdirSync(path.join(root, at), { withFileTypes: true });
  const here = entries.some((entry) => entry.isFile() && entry.name === "page.tsx") ? [at] : [];
  return [...here, ...entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).flatMap((entry) => routes(root, path.posix.join(at, entry.name)))];
}
/** A route's pattern: `[id]` is one segment, `[[...rest]]` any number, none included. */
const pattern = (route: string) => new RegExp(`^${route.split("/").filter(Boolean).map((part) => (part.startsWith("[[...") ? "(?:/.*)?" : part.startsWith("[...") ? "/.+" : part.startsWith("[") ? "/[^/]+" : `/${part}`)).join("") || "/"}$`);
/** An address a route answers to: each `[id]` filled in, an optional rest left out. */
const sample = (route: string) => `/${route.split("/").filter((part) => part && !part.startsWith("[[...")).map((part) => (part.startsWith("[") ? "x1" : part)).join("/")}`;

const own = routes(APP).filter((route) => route !== "o" && !route.startsWith("o/") && !route.startsWith("api/"));
const organization = routes(ORGANIZATION);
const answers = (routesOf: string[], address: string) => routesOf.some((route) => pattern(route).test(address.split(/[?#]/)[0]!));

it("names as a workspace's sections exactly the folders an organization has pages in, each of which a person's own workspace has too", () => {
  const folders = readdirSync(ORGANIZATION, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `/${entry.name}`);
  expect([...SECTIONS].sort()).toEqual(folders.sort());
  for (const section of SECTIONS) expect(existsSync(path.join(APP, section)), `${section} in a person's own workspace`).toBe(true);
});

it("lands a switch into an organization in that organization, on a page it has, from every page of the app", () => {
  for (const route of own) {
    const from = sample(route);
    const to = switchTarget("lab", from, "");
    // Never the address it left: the rail takes the workspace picked at the click, and waits for the page to follow.
    expect(to, `${from} goes nowhere`).not.toBe(from);
    expect(to === "/o/lab" || to.startsWith("/o/lab/"), `${from} lands at ${to}, outside the organization`).toBe(true);
    expect(answers(organization, bareWorkspacePath(to)), `${from} lands at ${to}, which is no page`).toBe(true);
  }
});

it("lands a switch out of an organization, to a person's own workspace or another organization, on a page that's there", () => {
  for (const route of organization) {
    const from = `/o/lab${sample(route) === "/" ? "" : sample(route)}`;
    const home = switchTarget(undefined, from, "");
    expect(home, `${from} goes nowhere`).not.toBe(from);
    expect(home.startsWith("/o/"), `${from} lands at ${home}, still in an organization`).toBe(false);
    expect(answers(own, home), `${from} lands at ${home}, which is no page`).toBe(true);
    const other = switchTarget("club", from, "");
    expect(other === "/o/club" || other.startsWith("/o/club/"), `${from} lands at ${other}, outside the organization picked`).toBe(true);
    expect(answers(organization, bareWorkspacePath(other)), `${from} lands at ${other}, which is no page`).toBe(true);
  }
});

it("keeps the page where the workspace picked has it, opens the section where the page shows one item, and goes home where it has no place", () => {
  expect(switchTarget("lab", "/history", "")).toBe("/o/lab/history");
  expect(switchTarget(undefined, "/o/lab/extraction/new", "")).toBe("/extraction/new");
  // What the address says after the ? is the workspace's that's left: a member to filter by, a search to screen, a job whose cost to show.
  expect(switchTarget(undefined, "/o/lab/history", "by=user_1")).toBe("/history");
  expect(switchTarget("lab", "/screening", "search=abc")).toBe("/o/lab/screening");
  expect(switchTarget("lab", "/settings/billing", "jobId=abc")).toBe("/o/lab/settings/billing");
  // An item is in one workspace only.
  expect(switchTarget("lab", "/library", "col=abc")).toBe("/o/lab/library");
  expect(switchTarget("lab", "/screening", "job=abc")).toBe("/o/lab/screening");
  expect(switchTarget(undefined, "/o/lab/extraction/abc", "")).toBe("/extraction");
  // Shared with me is a person's own, as are the deployment's settings.
  expect(switchTarget("lab", "/shared", "")).toBe("/o/lab");
  expect(switchTarget("lab", "/settings/admin/models", "")).toBe("/o/lab");
  // An organization's own settings are no person's.
  expect(switchTarget(undefined, "/o/lab/settings/workspace/members", "")).toBe("/settings");
});

it("sends someone outside an organization to the same page and item in their own workspace, and its own settings to theirs (#653)", () => {
  expect(outsiderTarget("/o/lab/library", "?chat=abc")).toBe("/library?chat=abc");
  expect(outsiderTarget("/o/lab/results/abc", "")).toBe("/results/abc");
  expect(outsiderTarget("/o/lab", "?chat=abc")).toBe("/?chat=abc");
  expect(outsiderTarget("/o/lab/settings/workspace/members", "?tab=x")).toBe("/settings");
});
