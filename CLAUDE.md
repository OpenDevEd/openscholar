<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

The convex and next development servers are running in pm2: you can and SHOULD consistently check the logs there.

## Testing philosophy — assert on behavior, not on source

**Never write tests that assert on CSS class strings, Tailwind utilities, or inline style values from source.** These are round-trip tests: the literal string in the `.tsx` flows through React → JSDOM → your regex, which tests nothing. They don't verify the browser actually clamped, colored, or sized anything — only that the string you pasted into the component is the string React rendered. They break on any cosmetic refactor (`text-destructive` → `text-red-600`) while the user-visible behavior is identical.

### Concretely, do not do this

```tsx
// ❌ asserting on Tailwind strings
expect(el.className).toMatch(/text-amber-600/);
expect(el).toHaveClass("flex-col", "h-6", "w-6");
expect(el.className).toContain("border-l-emerald-500");

// ❌ asserting on inline-style round-trips of your own constants
expect(dot.style.backgroundColor).toBe(`var(${SOURCE_COLOR_VAR[source]})`);

// ❌ asserting on layout classes that JSDOM cannot actually measure
expect(title.className).toMatch(/line-clamp-2/);
```

### Do this instead

1. **Test the semantic state**, not its CSS expression. If the component's behavior is "warn the user when at 90% of capacity", assert on the *warning message text* (`screen.getByRole("status")` + `toHaveTextContent(/approaching/i)`), not on the tint color class.
2. **Expose behavioral contracts via `data-*` or ARIA.** When a component's state is internally meaningful but only surfaces visually, add `data-capacity-state="near"`, `data-color-role="green"`, `data-source="history"`, or `aria-pressed={isSelected}` to the element — then assert on those attributes. The attribute becomes a real, refactor-stable contract.
3. **Push pure logic out of the render tree and unit-test it directly.** Threshold → color-role is a pure function; test it in a `lib/**.test.ts` file. The component's job is just to apply the resulting role; the class mapping is implementation.
4. **Visual layout (clamping, truncation, alignment) goes in visual-regression tests**, not JSDOM unit tests. JSDOM has no layout engine — asserting `toMatch(/line-clamp-2/)` doesn't prove the text wraps.
5. **Prefer `getByRole`, `getByText`, `getByLabelText`.** These are the accessibility tree — the same contract your users (and screen readers) actually consume.

### When a test is unavoidably about a class, something is wrong upstream

If you find yourself reaching for `.className.toMatch(...)` it usually means the source component is hiding a behavioral contract inside a CSS string. Fix the source — add a `data-*` or ARIA attribute that expresses the state — then test that attribute. The test becomes stable and the component becomes more scriptable.