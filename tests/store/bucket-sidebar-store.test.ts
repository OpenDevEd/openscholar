/**
 * @vitest-environment jsdom
 *
 * Unit test for the bucket sidebar store + dimensions factory.
 * Exercises the factory-produced hook directly; persistence is
 * covered by seeding localStorage in the component test.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  useBucketSidebarStore,
  getBucketSidebarDimensions,
} from "@/lib/store";

beforeEach(() => {
  window.localStorage.clear();
  useBucketSidebarStore.setState({ isCollapsed: false });
});

describe("useBucketSidebarStore", () => {
  test("defaults to isCollapsed === false", () => {
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(false);
  });

  test("toggle flips the collapse flag", () => {
    useBucketSidebarStore.getState().toggle();
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(true);
    useBucketSidebarStore.getState().toggle();
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(false);
  });

  test("setCollapsed writes the passed value", () => {
    useBucketSidebarStore.getState().setCollapsed(true);
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(true);
    useBucketSidebarStore.getState().setCollapsed(false);
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(false);
  });
});

describe("getBucketSidebarDimensions", () => {
  test("expanded state returns 360 / 48 / 360", () => {
    expect(getBucketSidebarDimensions(false)).toEqual({
      expandedWidth: 360,
      collapsedWidth: 48,
      currentWidth: 360,
    });
  });

  test("collapsed state returns 360 / 48 / 48", () => {
    expect(getBucketSidebarDimensions(true)).toEqual({
      expandedWidth: 360,
      collapsedWidth: 48,
      currentWidth: 48,
    });
  });
});
