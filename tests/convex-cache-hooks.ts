// The app reads Convex through convex-helpers' cached hooks, which keep a query live after the page that read it is
// gone (components/providers/convex-provider.tsx). A test has no page to come back to: it reads straight through
// convex/react, so a test that stands in for convex/react stands in for these too.
export { useQueries, useQuery, usePaginatedQuery } from "convex/react";
