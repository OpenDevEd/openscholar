// convex/test.setup.ts
// Source: https://docs.convex.dev/testing/convex-test
/// <reference types="vite/client" />

// Discover all Convex function modules for convex-test isolation
// The glob matches every file with a single extension ending in 's' (js, ts)
// but excludes files with multiple dots (e.g., auth.config.ts, convex.config.ts)
export const modules = import.meta.glob("./**/!(*.*.*)*.*s");
