<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

The convex and next development servers are running in pm2: you can and SHOULD consistently check the logs there.

## Testing philosophy — assert on behavior, not on source

**Never write tests that assert on CSS class strings, Tailwind utilities, or inline style values from source.** Class-name assertions are round-trip tests — the literal string in the `.tsx` flows through React → JSDOM → your regex, which tests nothing. They don't verify the browser actually clamped, colored, or sized anything. They break on cosmetic refactors while user-visible behavior is identical.

### Forbidden patterns

```tsx
// ❌ these are noise, not tests
expect(el.className).toMatch(/text-amber-600/);
expect(el).toHaveClass("flex-col", "h-6", "w-6");
expect(el.className).toContain("border-l-emerald-500");
expect(dot.style.backgroundColor).toBe(`var(${SOURCE_COLOR_VAR[source]})`);
expect(title.className).toMatch(/line-clamp-2/); // JSDOM can't measure layout
```

### Required approach

1. **Test the semantic state, not its CSS expression.** `screen.getByRole("status")` with `toHaveTextContent(/approaching/i)` beats asserting on a tint class.
2. **Expose behavioral contracts via `data-*` or ARIA.** `data-capacity-state="near"`, `data-color-role="green"`, `data-source="history"`, `aria-pressed={isSelected}` — then assert on the attribute. It becomes a real, refactor-stable contract.
3. **Push pure logic out of components and unit-test it in `lib/**.test.ts`.** Threshold → color-role mapping is a pure function; don't test it through a rendered component.
4. **Visual layout (clamping, truncation, alignment) is a visual-regression concern.** JSDOM has no layout engine. Use Playwright / screenshot tests, not `toMatch(/line-clamp-2/)`.
5. **Prefer `getByRole`, `getByText`, `getByLabelText`.** These query the accessibility tree — the same contract users and screen readers consume.

### When you can't avoid reaching for a class assertion

You're probably hiding a behavioral contract inside a CSS string. Fix the source — add `data-*` or ARIA — then test that. Do not write `.className.toMatch(...)` as a shortcut.

**Applies equally when writing plans.** Phase plans (under `.agents/audit/plans/`) must specify verification criteria in terms of observable behavior (text, role, ARIA, data-attributes, store state). Never prescribe "assert `line-clamp-2` class" or "check `text-destructive` is applied" — that's instructing the executor to write source-round-trip tests.