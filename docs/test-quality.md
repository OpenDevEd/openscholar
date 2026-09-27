# Test quality standard

The `test-decision` skill decides whether a change needs a test at all. This
guide covers what a test must prove once it does.

## What a useful test proves

Every test needs a clear claim, a real public boundary, an independent result,
failure sensitivity, and isolated disposable state.

Use the smallest honest boundary:

| Claim | Check | Observe |
|---|---|---|
| Pure calculation or validation | Unit test | Return value or error |
| Convex mutation or transaction | Integration test | Rows, jobs, and rollback |
| Route or authentication contract | HTTP test | Status, headers, body, and saved state |
| User interaction | Browser test | Roles, labels, visible state, URL, and resulting data |
| Layout or visual styling | Screenshot or visual check | Rendered result at the needed viewport |
| Import or architecture restriction | ESLint, TypeScript, or a named static check | Exact source violation |
| Model output | Production-like evaluation set | Task quality, failure types, time, and cost |

Do not replace an integration claim with mocks. Do not use a browser when a
pure function gives the same confidence faster.

## Reject these tests

Reject or rewrite tests that:

- scan production source for a function name, local variable, call shape, or
  code fragment and call that behavior coverage;
- copy the implementation into the assertion;
- prove only that a configured mock returned its configured value;
- assert only `toBeDefined()`, `not.toThrow()`, a broad snapshot, or call count
  while accepting the wrong result;
- freeze CSS classes, DOM nesting, private functions, or ordinary wording;
- depend on fixed sleeps, old cookies, leaked mocks, shared rows, test order, or
  abandoned processes; or
- pass locally but do not run in the required CI job.

Static source rules belong in lint, TypeScript, or a named static check. Do not
count them as behavior tests.

## Bad and good examples

Bad source scan:

```ts
expect(readFileSync("convex/credits/internal.ts", "utf8"))
  .toContain("refundPayment");
```

Good: run the refund twice through the public boundary and check the credit
transaction, total refund, and idempotency result in the database.

Bad self-proving mock:

```ts
provider.publish.mockResolvedValue({ id: "123" });
expect(await publishRecord()).toEqual({ id: "123" });
```

Good: keep request construction, persistence, response handling, and duplicate
protection real. Fake only the outside network and assert the saved job and
public receipt.

## Review checklist

Before committing a test change, confirm:

- the change needs a test rather than only an existing check or real inspection;
- every assertion names a behavior and concrete defect;
- new plain logic failed for the expected reason before implementation;
- mocks stop only at outside boundaries;
- browser checks use roles, labels, visible text, or stable test IDs;
- state is isolated and cleaned up; and
- the focused test and every required wider check ran without watch mode.

## Primary guides

- [Vitest: Writing Tests with AI](https://main.vitest.dev/guide/learn/writing-tests-with-ai)
- [Playwright: Best Practices](https://playwright.dev/docs/best-practices)
- [Testing Library: Guiding Principles](https://testing-library.com/docs/guiding-principles/)
- [Stryker: What is mutation testing?](https://stryker-mutator.io/docs/)
- [OpenAI: How evals drive the next chapter in AI](https://openai.com/index/evals-drive-next-chapter-of-ai/)
