# Domain Pitfalls — Library UI Overhaul (v2.2)

**Domain:** UI redesign for library page — two-column layout with sidebar filters
**Researched:** 2026-03-01
**Confidence:** HIGH (patterns battle-tested in search page)

## Critical Pitfalls

Mistakes that cause rewrites or major issues. Prevent at all costs.

### Pitfall 1: Layout Shift on Mobile Viewport Change

**What goes wrong:**
Server renders desktop layout (two columns), client initializes with `useMediaQuery()` and renders mobile layout (tabs). User sees layout flicker/shift during hydration. CLS (Cumulative Layout Shift) metric fails. Looks janky, feels broken.

**Why it happens:**
Mixing server-rendered layout with client-side media query detection. Server and client disagree on what to render.

**Consequences:**
- User sees flicker on page load
- CLS metric (Web Vitals) fails
- Mobile experience feels broken on first paint
- Especially bad if page is cached by CDN (stale server render)

**Prevention:**
1. Use CSS media queries ONLY for layout (`flex-col lg:flex-row`), never JS
2. Use Tailwind breakpoints: `hidden lg:block` / `lg:hidden`
3. If layout differs significantly, consider different pages or render placeholder
4. Test on actual mobile device, not just DevTools emulation

**Detection:**
- [ ] Check Core Web Vitals in Lighthouse (CLS should be < 0.1)
- [ ] Load page on mobile, watch first paint (no flicker)
- [ ] Use DevTools "Emulate CSS media feature prefers-reduced-motion" to verify responsiveness
- [ ] Test with slow 3G network to see layout during slow hydration

**Example (correct):**
```typescript
// Right: CSS-only responsive
export function LibraryPageClient() {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      <div className="lg:sticky lg:top-0 lg:w-80 lg:shrink-0">
        <LibraryFilterSidebar /> {/* Always renders both desktop and mobile */}
      </div>
      <div className="flex-1">
        <LibraryResults />
      </div>
    </div>
  );
}

// Wrong: JS-based layout
if (isMobile) return <MobileLayout />; // Different content!
return <DesktopLayout />;
```

---

### Pitfall 2: Filter State Out of Sync with URL

**What goes wrong:**
User sets filter (e.g., year 2020-2023), but URL doesn't update. User refreshes page → filter resets. Back button doesn't restore filter. Bookmarked filtered view doesn't work. Users can't share links to specific filtered views.

**Why it happens:**
Storing filter state in Zustand/useState instead of URL. Developer forgets to sync state to URL, or syncs with lag (useEffect race conditions).

**Consequences:**
- Filters reset on page refresh → user frustration
- Back button doesn't work → broken navigation UX
- Can't bookmark filtered views → productivity lost
- Can't share links with colleagues → collaboration broken

**Prevention:**
1. **Store filters ONLY in URL via nuqs**, never in component state
2. Use `useQueryStates()` from nuqs, not useState
3. Call `setParams()` directly on filter change, no intermediate useState
4. Define filter schema with zod (`librarySearchParams`) to validate/coerce types

**Detection:**
- [ ] Adjust a filter, check if URL changes immediately
- [ ] Refresh page, verify filter persists
- [ ] Click back button, verify previous filter state restored
- [ ] Share URL with another tab, verify both show identical filters

**Example (correct):**
```typescript
// Right: Filter state in URL
const [params, setParams] = useQueryStates(librarySearchParams);

const handleYearChange = (from, to) => {
  setParams({ yf: from, yt: to }); // Direct URL sync
};

// Wrong: Intermediate state
const [yearFrom, setYearFrom] = useState();
useEffect(() => {
  setParams({ yf: yearFrom }); // Race condition, lag
}, [yearFrom]);
```

---

### Pitfall 3: Sidebar Not Sticky (Content Scrolls Away Sidebar)

**What goes wrong:**
User scrolls down results, sidebar scrolls up out of view. Sidebar disappears. User can't adjust filters without scrolling back to top. Desktop experience feels broken.

**Why it happens:**
Forgot `lg:sticky lg:top-0` on sidebar element. Only tested on mobile, not desktop.

**Consequences:**
- Desktop UX broken (can't see filters while scrolling results)
- Users frustrated, scroll to top repeatedly
- Filters feel inaccessible

**Prevention:**
1. Add `sticky top-0 h-screen overflow-hidden` to sidebar container
2. Use `overflow-y-auto` on ScrollArea inside sidebar to allow scrolling within sidebar
3. Test on desktop at lg breakpoint: adjust a filter, scroll results, verify sidebar stays visible
4. Use fixed width or flex-shrink-0 to prevent sidebar collapsing

**Detection:**
- [ ] Load page at desktop (lg+), scroll down results
- [ ] Verify sidebar is still visible
- [ ] Scroll sidebar content (filters scroll within sidebar, not whole page)
- [ ] No layout shift when scrolling

**Example (correct):**
```typescript
// Right: Sticky sidebar with scroll area
<div className="flex lg:flex-row flex-col">
  <div className="lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:w-80 overflow-hidden">
    <ScrollArea className="h-full">
      <LibraryFilterSidebar /> {/* Scrolls within sidebar */}
    </ScrollArea>
  </div>
  <div className="flex-1 overflow-auto">
    <LibraryResults /> {/* Scrolls separately */}
  </div>
</div>
```

---

### Pitfall 4: Mobile Tab Animation Causes Layout Thrashing

**What goes wrong:**
User clicks Filters tab, animation is janky. Frame rate drops, animation stutters. Feels slow and broken. Looks like a performance issue even if it's just animation config.

**Why it happens:**
Using Motion's height animation instead of layoutId + layout prop. Or using wrong spring config (stiffness/damping values too high/low). Or `mode="popLayout"` not used in AnimatePresence.

**Consequences:**
- Jank on tab switch (immediately noticeable, breaks UX)
- User doesn't click tabs again (thinks app is slow)
- Performance appears worse than it is

**Prevention:**
1. Use Motion's `layout` prop, not manual height animation
2. Use `mode="popLayout"` in AnimatePresence (prevents layout shift jank)
3. Use proven spring configs from `/lib/animation-config.ts` (subtleSpring)
4. Test on mobile device, not just fast desktop
5. Profile with DevTools Performance tab to verify 60fps

**Detection:**
- [ ] Click tabs on mobile (real device, not DevTools emulation)
- [ ] Watch animation for stuttering, jank, frame drops
- [ ] Use Chrome DevTools Performance tab, frame rate should be 60fps
- [ ] Compare to search page tabs (should match smoothness)

**Example (correct):**
```typescript
// Right: Motion layout + popLayout mode
<AnimatePresence mode="popLayout" custom={direction}>
  {activeTab === "results" ? (
    <motion.div
      key="results"
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={subtleSpring} // Use proven config
    >
      <LibraryResults />
    </motion.div>
  ) : (
    <motion.div key="filters" /* ... */>
      <LibraryFilterSidebar />
    </motion.div>
  )}
</AnimatePresence>

// Wrong: Direct height animation
animate={{ height: activeTab === "results" ? "auto" : 0 }}
```

---

### Pitfall 5: Filter Sections Overflowing on Mobile

**What goes wrong:**
On mobile, all filter sections visible at once. Sidebar becomes very tall (100+ vh). Users have to scroll forever to see all filters. UX feels cluttered and broken. Or worse, filter section content (sliders, pickers) goes off-screen.

**Why it happens:**
Didn't add ScrollArea to sidebar, or ScrollArea height not constrained. Or filter groups not collapsible.

**Consequences:**
- Mobile sidebar takes forever to scroll
- Users miss filters below the fold
- Filter pickers (year, rating) can't fit on screen
- UX feels broken on mobile

**Prevention:**
1. Wrap sidebar content in ScrollArea with constrained height
2. For mobile, consider collapsible filter groups (Radix Collapsible)
3. Or limit visible filters on mobile, collapse "advanced" section
4. Test with realistic filter count (not just 2 filters)
5. Use DevTools mobile emulation AND real phone

**Detection:**
- [ ] Load on mobile, scroll sidebar
- [ ] Check if all filters are accessible without excessive scrolling
- [ ] Check if filter pickers fit on screen (year slider, rating slider)
- [ ] Compare to search page mobile (should feel similar)

**Example (correct):**
```typescript
// Right: Constrained scroll area
<div className="h-screen lg:sticky lg:top-0 overflow-hidden">
  <ScrollArea className="h-full">
    <div className="space-y-4 p-4">
      <FilterSection title="Date Saved">...</FilterSection>
      <FilterSection title="Year Range">...</FilterSection>
      <FilterSection title="Rating">...</FilterSection>
      <FilterSection title="Collections">...</FilterSection>
    </div>
  </ScrollArea>
</div>
```

---

## Moderate Pitfalls

Mistakes that cause bugs or UX issues. Should avoid, but not catastrophic.

### Pitfall 6: Missing Filter Clear Buttons

**What goes wrong:**
Filter is active, but no way to clear it. User has to manually reset sliders, pickers. Or they re-do the entire filter. Feels clunky.

**Why it happens:**
Forgot to add `onClear` to FilterSection, or FilterSection's clear button doesn't actually clear the filter.

**Consequences:**
- Users frustrated trying to clear filters
- Filters feel not useful if hard to undo
- UX feels incomplete

**Prevention:**
1. Every FilterSection MUST have `onClear` callback
2. onClear should call `setParams({ filterKey: undefined })`
3. Use FilterSection's built-in clear button (X icon in header)
4. Test: set filter, click clear button, verify filter resets

**Detection:**
- [ ] For every filter in sidebar, click "Clear" button
- [ ] Verify filter is removed from URL
- [ ] Verify results update to show all items again

**Example (correct):**
```typescript
<FilterSection
  title="Year Range"
  icon={Calendar}
  isActive={isYearFilterActive}
  onClear={() => setParams({ yf: undefined, yt: undefined })}
>
  <YearRangePicker ... />
</FilterSection>
```

---

### Pitfall 7: Dark Mode Colors Not Applied

**What goes wrong:**
User toggles dark mode, sidebar and filters look wrong. Colors are too bright or invisible. CSS variables not applied. Looks like app is broken in dark mode.

**Why it happens:**
CSS variables defined in globals.css but not applied to component (missing `dark:` class). Or Tailwind dark mode not enabled. Or component has hardcoded colors instead of CSS variables.

**Consequences:**
- Dark mode looks broken
- Users avoid using dark mode
- App feels incomplete

**Prevention:**
1. All colors should use CSS variables (--sidebar, --primary, etc.)
2. Apply `dark:` prefix for dark mode variants: `bg-sidebar dark:bg-sidebar`
3. Use existing utility classes: `glass-sidebar` (already has dark variant)
4. Test: toggle dark mode, verify all colors correct
5. Use globals.css vars, not inline Tailwind colors

**Detection:**
- [ ] Toggle dark mode via theme switcher
- [ ] Check sidebar colors, scrollbar, borders, text
- [ ] Check contrast meets WCAG AA (4.5:1)
- [ ] Compare to search page dark mode (should match)

**Example (correct):**
```typescript
// Right: CSS variables + dark mode
<div className="glass-sidebar"> {/* Already has light/dark variants */}
  <FilterSection ... /> {/* Uses sidebar color vars */}
</div>

// Wrong: Hardcoded colors
<div className="bg-white dark:bg-gray-900"> {/* Breaks design system */}
```

---

### Pitfall 8: Missing i18n Translations

**What goes wrong:**
Filter labels show "Year Range" on English, but on French or Spanish the label doesn't exist. Shows blank, or shows English fallback, or shows key name. Feels unfinished.

**Why it happens:**
Copied text from search page but forgot to add translations. Or used hardcoded strings instead of `useTranslations()`.

**Consequences:**
- Non-English users see broken text
- App feels unprofessional, incomplete
- Feature feels not localized

**Prevention:**
1. Use `useTranslations("libraryFilters")` for all filter labels
2. Define all label keys in translation files (6 locales)
3. Copy translation keys from search page if they're the same
4. Test: switch to different locale, verify all labels show correctly
5. Use automated i18n checks in CI (flag missing keys)

**Detection:**
- [ ] Switch language to Spanish, French, German, Japanese, Chinese, Portuguese
- [ ] Verify all filter labels display correctly
- [ ] Check no English text appears unexpectedly
- [ ] Verify button labels, error messages translated

**Example (correct):**
```typescript
import { useTranslations } from 'next-intl';

export function LibraryFilterSidebar() {
  const t = useTranslations('libraryFilters');

  return (
    <FilterSection title={t('yearRange')}>
      ...
    </FilterSection>
  );
}
```

---

### Pitfall 9: Accessibility Not Tested (Keyboard Nav, Screen Readers)

**What goes wrong:**
App works fine with mouse, but keyboard navigation broken. Tab order wrong, buttons not focusable. Screen reader can't read filter labels. A11y audit fails.

**Why it happens:**
Only tested with mouse, never tested keyboard navigation or screen readers. Or broke built-in a11y from Radix primitives by overriding aria attributes.

**Consequences:**
- Keyboard-only users can't use app
- Screen reader users can't access filters
- Fails a11y compliance requirements
- May violate WCAG standards

**Prevention:**
1. Radix primitives (Tabs, Dialog, Collapsible) ship with a11y built-in
2. Don't override aria-* attributes unless necessary
3. Test keyboard navigation: Tab through all controls, Shift+Tab backwards
4. Test with screen reader (NVDA on Windows, VoiceOver on Mac)
5. Use axe browser extension to find a11y issues

**Detection:**
- [ ] Tab through all filters, buttons, controls
- [ ] Verify focus order makes sense
- [ ] Verify all buttons have keyboard shortcuts or are reachable via Tab
- [ ] Use axe DevTools to scan for a11y issues
- [ ] Test with screen reader (NVDA, JAWS, VoiceOver)

**Example (correct):**
```typescript
// Right: Use Radix primitives (a11y built-in)
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="results">Results</TabsTrigger>
    <TabsTrigger value="filters">Filters</TabsTrigger>
  </TabsList>
  {/* Radix handles keyboard navigation, ARIA attributes */}
</Tabs>
```

---

## Minor Pitfalls

Low-severity issues. Nice to avoid, but not blocking.

### Pitfall 10: Scrollbar Not Visible on Sidebar

**What goes wrong:**
User scrolls sidebar on desktop, but scrollbar is invisible. Hard to tell if content is scrollable.

**Why it happens:**
Scrollbar hidden by default (scrollbar-hide utility) for aesthetic reasons. But not visible on hover.

**Prevention:**
Apply `scrollbar-hover` utility to show scrollbar on hover. Or use `sidebar-scrollbar` for custom styled scrollbar.

**Example:**
```typescript
<ScrollArea className="h-full sidebar-scrollbar">
  {/* Scrollbar visible with custom styling */}
</ScrollArea>
```

---

### Pitfall 11: Filter Clear Button Clashing with Section Title

**What goes wrong:**
On small screens, "Clear" button overlaps with filter title. Text gets cut off or button hides title.

**Why it happens:**
Header flex space too small for both title and button.

**Prevention:**
Use flexbox with `justify-between` and `flex-shrink` on button. Or wrap on small screens.

**Example:**
```typescript
<div className="flex items-center justify-between flex-wrap gap-2">
  <h3>{title}</h3>
  {isActive && <Button size="sm">Clear</Button>}
</div>
```

---

### Pitfall 12: Empty State Not Shown

**What goes wrong:**
User adjusts filters to match zero results. Page shows nothing, user thinks app is broken or loading forever.

**Why it happens:**
Forgot to render LibraryEmptyState when results.length === 0.

**Prevention:**
Check `if (results.length === 0) return <LibraryEmptyState />` before rendering list.

**Example:**
```typescript
{results.length === 0 ? (
  <LibraryEmptyState searchText={params.q} />
) : (
  <LibraryItemList items={results} />
)}
```

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| Phase 1 (Layout) | Sidebar not sticky, content scrolls away | Add `lg:sticky lg:top-0` to sidebar; test on desktop |
| Phase 2 (Mobile) | Layout shift on hydration | Use CSS media queries only, not JS responsiveness; check CLS metric |
| Phase 2 (Mobile) | Tab animation jank | Use Motion `layout` prop + `mode="popLayout"`, proven spring config |
| Phase 3 (Animation) | Collapsible filter animation jank | Use Motion's `layout` + `layoutId`, not height animation |
| Phase 4 (i18n) | Missing translations | Sync with search page translation keys; test all 6 locales |
| Phase 4 (i18n) | Hardcoded English strings | Use `useTranslations()` for all user-facing text |
| Phase 4 (a11y) | Keyboard nav broken | Test Tab/Shift+Tab; verify focus order makes sense |
| Phase 5 (Tests) | E2E tests flaky on mobile | Use real mobile device or emulator with realistic network speed |

---

## Quick Checklist Before Merging

- [ ] **Layout:** Desktop view has two columns, sidebar sticky, content scrolls separately
- [ ] **Mobile:** Tabs toggle works, animation smooth, no flicker, no layout shift
- [ ] **Filters:** All filters have clear buttons, URL updates on change, page refresh preserves filters
- [ ] **Dark mode:** Sidebar, scrollbar, text colors correct in dark mode
- [ ] **i18n:** All filter labels translated, tested in all 6 locales
- [ ] **a11y:** Tab navigation works, screen reader reads labels, axe scan passes
- [ ] **Performance:** Tab animation 60fps, no jank, CLS < 0.1
- [ ] **Tests:** Unit tests for FilterSection, state sync; E2E tests for mobile/desktop
- [ ] **Browser testing:** Tested on Chrome, Firefox, Safari (if applicable)
- [ ] **Mobile device:** Tested on real phone, not just DevTools emulation

---

**Last Updated:** 2026-03-01
**Status:** Pitfalls identified, mitigations documented, ready for implementation.
