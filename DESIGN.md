# OpenScholar Design System

> Complete redesign from centered layout to modern sidebar-based design with orange (#e68124) branding.

---

## Table of Contents

1. [Color System](#color-system)
2. [Layout Architecture](#layout-architecture)
3. [Component Specifications](#component-specifications)
4. [Visual Design Language](#visual-design-language)
5. [Page Designs](#page-designs)
6. [Implementation Plan](#implementation-plan)

---

## Color System

### Primary Brand Color

**Hex:** `#e68124`  
**OKLCH:** `oklch(0.70 0.17 54)`

### Primary Color Scale

| Token | OKLCH | Usage |
|-------|-------|-------|
| `--primary-50` | `oklch(0.97 0.02 55)` | Subtle backgrounds |
| `--primary-100` | `oklch(0.93 0.04 55)` | Hover backgrounds |
| `--primary-200` | `oklch(0.87 0.08 55)` | Light accents |
| `--primary-300` | `oklch(0.80 0.12 55)` | Borders, dividers |
| `--primary-400` | `oklch(0.75 0.15 55)` | Secondary buttons |
| `--primary-500` | `oklch(0.70 0.17 54)` | **Brand color** |
| `--primary-600` | `oklch(0.62 0.16 52)` | Hover primary |
| `--primary-700` | `oklch(0.52 0.14 50)` | Active states |
| `--primary-800` | `oklch(0.42 0.11 48)` | Dark accents |
| `--primary-900` | `oklch(0.32 0.08 46)` | Very dark |

### Light Theme

```css
:root {
  /* Core */
  --background: oklch(0.985 0.002 75);
  --foreground: oklch(0.25 0.015 60);
  
  /* Cards & Popovers */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.20 0.015 60);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.25 0.015 60);
  
  /* Primary - Orange Brand */
  --primary: oklch(0.70 0.17 54);
  --primary-foreground: oklch(1 0 0);
  
  /* Secondary */
  --secondary: oklch(0.955 0.01 60);
  --secondary-foreground: oklch(0.35 0.02 60);
  
  /* Muted */
  --muted: oklch(0.955 0.008 60);
  --muted-foreground: oklch(0.55 0.01 60);
  
  /* Accent */
  --accent: oklch(0.93 0.04 55);
  --accent-foreground: oklch(0.30 0.02 55);
  
  /* Destructive */
  --destructive: oklch(0.55 0.22 27);
  --destructive-foreground: oklch(1 0 0);
  
  /* Borders & Inputs */
  --border: oklch(0.90 0.005 60);
  --input: oklch(0.90 0.005 60);
  --ring: oklch(0.70 0.17 54);
  
  /* Sidebar */
  --sidebar: oklch(0.975 0.006 55);
  --sidebar-foreground: oklch(0.35 0.015 60);
  --sidebar-primary: oklch(0.70 0.17 54);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.94 0.03 55);
  --sidebar-accent-foreground: oklch(0.30 0.02 55);
  --sidebar-border: oklch(0.91 0.008 55);
  --sidebar-ring: oklch(0.70 0.17 54);
  
  /* Charts */
  --chart-1: oklch(0.70 0.17 54);
  --chart-2: oklch(0.65 0.15 200);
  --chart-3: oklch(0.75 0.12 140);
  --chart-4: oklch(0.60 0.18 330);
  --chart-5: oklch(0.55 0.14 280);
  
  /* Radius */
  --radius: 0.75rem;
}
```

### Dark Theme

```css
.dark {
  /* Core */
  --background: oklch(0.17 0.01 55);
  --foreground: oklch(0.92 0.008 60);
  
  /* Cards & Popovers */
  --card: oklch(0.21 0.012 55);
  --card-foreground: oklch(0.95 0.005 60);
  --popover: oklch(0.23 0.012 55);
  --popover-foreground: oklch(0.92 0.008 60);
  
  /* Primary - Orange Brand (slightly brighter for dark mode) */
  --primary: oklch(0.72 0.17 54);
  --primary-foreground: oklch(0.15 0.01 55);
  
  /* Secondary */
  --secondary: oklch(0.25 0.012 55);
  --secondary-foreground: oklch(0.85 0.008 60);
  
  /* Muted */
  --muted: oklch(0.23 0.01 55);
  --muted-foreground: oklch(0.65 0.01 60);
  
  /* Accent */
  --accent: oklch(0.28 0.03 55);
  --accent-foreground: oklch(0.92 0.01 55);
  
  /* Destructive */
  --destructive: oklch(0.60 0.20 27);
  --destructive-foreground: oklch(1 0 0);
  
  /* Borders & Inputs */
  --border: oklch(0.30 0.012 55);
  --input: oklch(0.30 0.012 55);
  --ring: oklch(0.72 0.17 54);
  
  /* Sidebar */
  --sidebar: oklch(0.15 0.008 55);
  --sidebar-foreground: oklch(0.85 0.008 60);
  --sidebar-primary: oklch(0.72 0.17 54);
  --sidebar-primary-foreground: oklch(0.15 0.01 55);
  --sidebar-accent: oklch(0.24 0.02 55);
  --sidebar-accent-foreground: oklch(0.90 0.008 55);
  --sidebar-border: oklch(0.28 0.01 55);
  --sidebar-ring: oklch(0.72 0.17 54);
  
  /* Radius (slightly smaller in dark mode) */
  --radius: 0.625rem;
}
```

---

## Layout Architecture

### Global Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────────────────────────┐ │
│ │          │ │                                                │ │
│ │ SIDEBAR  │ │                 MAIN CONTENT                   │ │
│ │          │ │                                                │ │
│ │ 280px    │ │  ┌──────────────────────────────────────────┐  │ │
│ │ expanded │ │  │                                          │  │ │
│ │          │ │  │           PAGE CONTENT                   │  │ │
│ │ 72px     │ │  │                                          │  │ │
│ │ collapsed│ │  │                                          │  │ │
│ │          │ │  └──────────────────────────────────────────┘  │ │
│ │          │ │                                                │ │
│ │          │ │  ┌──────────────────────────────────────────┐  │ │
│ │          │ │  │               FOOTER                     │  │ │
│ └──────────┘ │  └──────────────────────────────────────────┘  │ │
│              └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Sidebar Structure

```
┌─────────────────────────────────┐
│  ┌─────────────────────────┐    │
│  │  LOGO + Collapse Toggle │    │  ← Header
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │  Quick Search Input     │    │  ← Search (Cmd+K hint)
│  └─────────────────────────┘    │
│                                 │
│  ── Primary Navigation ──────   │
│  ○ Home                         │
│  ○ Results                      │
│  ○ Bookmarks                    │
│  ○ AI Enhancement               │
│                                 │
│  ── Search History ──────────   │
│  ◦ Recent search 1              │
│  ◦ Recent search 2              │
│  ◦ Recent search 3              │
│  ◦ Recent search 4              │
│  ◦ Recent search 5              │
│    [Show all...]                │
│                                 │
│  ── Filters (Results only) ──   │  ← Conditional section
│  ◦ Date/Year Range              │
│  ◦ Country/Region               │
│  ◦ Country Focus                │
│  ◦ Citations (Cites/Cited By)   │
│  ◦ Related To                   │
│  ◦ Review Filter                │
│                                 │
│  ─────────────────────────────  │
│  ┌─────────────────────────┐    │
│  │ Theme Toggle │ Settings │    │  ← Footer
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

### Responsive Breakpoints

| Breakpoint | Width | Sidebar Behavior |
|------------|-------|------------------|
| `xl` | >= 1280px | Expanded by default (280px) |
| `lg` | 1024-1279px | Collapsed by default (72px), expandable |
| `md` | 768-1023px | Hidden, Sheet overlay |
| `sm` | < 768px | Hidden, Full-width Sheet |

### Sidebar States

| State | Width | Content |
|-------|-------|---------|
| Expanded | 280px | Full labels + icons |
| Collapsed | 72px | Icons only with tooltips |
| Mobile | 100% (Sheet) | Full content in overlay |

---

## Component Specifications

### 1. SidebarProvider

**File:** `components/sidebar-provider.tsx`

```typescript
interface SidebarContextValue {
  isOpen: boolean;        // Sheet open state (mobile)
  isCollapsed: boolean;   // Collapsed state (desktop)
  isMobile: boolean;      // Responsive detection
  toggle: () => void;     // Toggle collapsed/expanded
  setOpen: (open: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
}
```

**Features:**
- Persists `isCollapsed` in localStorage
- Keyboard shortcut: `Cmd/Ctrl + B` to toggle
- Auto-detects mobile breakpoint
- Syncs with system preferences

### 2. AppSidebar

**File:** `components/app-sidebar.tsx`

**Sections:**
1. **Header**: Logo + collapse button
2. **Search**: Quick search with `Cmd+K` hint
3. **Navigation**: Home, Results, Bookmarks, AI Enhancement
4. **History**: Last 5 searches + "Show all" link
5. **Filters**: Merged from SearchSidebar (conditional)
6. **Footer**: Theme toggle + Settings button

**Props:**
```typescript
interface AppSidebarProps {
  className?: string;
}
```

### 3. SettingsDialog

**File:** `components/settings-dialog.tsx`

**Sections:**
- AI Configuration (provider, API key, model)
- Appearance (theme preference)
- Search Defaults (filters, sort)
- Data Management (export, import, clear)

### 4. Logo (Updated)

**File:** `components/logo.tsx`

**Changes:**
- Orange gradient icon background
- Sidebar-aware sizing
- Collapsed mode: icon only

**Gradient:**
```css
background: linear-gradient(135deg, 
  oklch(0.75 0.15 55) 0%, 
  oklch(0.70 0.17 54) 50%, 
  oklch(0.62 0.16 52) 100%
);
```

---

## Visual Design Language

### Glassmorphism

```css
.glass {
  background: oklch(1 0 0 / 0.6);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid oklch(0 0 0 / 0.05);
}

.dark .glass {
  background: oklch(0.2 0.01 55 / 0.6);
  border: 1px solid oklch(1 0 0 / 0.08);
}

.glass-card {
  @apply glass rounded-xl;
  box-shadow: 
    0 4px 6px -1px oklch(0 0 0 / 0.05),
    0 2px 4px -2px oklch(0 0 0 / 0.05),
    inset 0 1px 0 0 oklch(1 0 0 / 0.1);
}
```

### Shadows

```css
--shadow-sm: 0 1px 2px 0 oklch(0 0 0 / 0.05);
--shadow: 0 1px 3px 0 oklch(0 0 0 / 0.08), 0 1px 2px -1px oklch(0 0 0 / 0.08);
--shadow-md: 0 4px 6px -1px oklch(0 0 0 / 0.08), 0 2px 4px -2px oklch(0 0 0 / 0.05);
--shadow-lg: 0 10px 15px -3px oklch(0 0 0 / 0.08), 0 4px 6px -4px oklch(0 0 0 / 0.05);
--shadow-xl: 0 20px 25px -5px oklch(0 0 0 / 0.1), 0 8px 10px -6px oklch(0 0 0 / 0.05);
--shadow-glow: 0 0 20px 0 oklch(0.70 0.17 54 / 0.3);
```

### Micro-Animations

```css
/* Sidebar Collapse */
.sidebar-transition {
  transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Button Hover */
.btn-hover {
  transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
}
.btn-hover:hover {
  transform: translateY(-1px);
}
.btn-hover:active {
  transform: translateY(0);
}

/* Card Hover */
.card-hover {
  transition: transform 200ms ease, box-shadow 200ms ease;
}
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* Focus Ring Pulse */
@keyframes focus-pulse {
  0%, 100% { box-shadow: 0 0 0 0 oklch(0.70 0.17 54 / 0.4); }
  50% { box-shadow: 0 0 0 4px oklch(0.70 0.17 54 / 0); }
}

/* Skeleton Shimmer */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg,
    oklch(0.95 0.005 60) 25%,
    oklch(0.90 0.005 60) 50%,
    oklch(0.95 0.005 60) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### Typography

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| Display | 3rem (48px) | 700 | 1.1 |
| H1 | 2.25rem (36px) | 700 | 1.2 |
| H2 | 1.875rem (30px) | 600 | 1.25 |
| H3 | 1.5rem (24px) | 600 | 1.3 |
| H4 | 1.25rem (20px) | 500 | 1.4 |
| Body | 1rem (16px) | 400 | 1.5 |
| Small | 0.875rem (14px) | 400 | 1.5 |
| Caption | 0.75rem (12px) | 500 | 1.4 |

### Spacing Scale

Base unit: 4px

```
0: 0px
1: 4px
2: 8px
3: 12px
4: 16px
5: 20px
6: 24px
8: 32px
10: 40px
12: 48px
16: 64px
20: 80px
24: 96px
```

---

## Page Designs

### Home Page

```
┌────────────────────────────────────────────────────────────┐
│ SIDEBAR │                                                  │
│         │                                                  │
│         │         ┌────────────────────────────┐           │
│         │         │                            │           │
│         │         │      🎓 OpenScholar        │           │
│         │         │                            │           │
│         │         │  Search millions of        │           │
│         │         │  academic papers           │           │
│         │         │                            │           │
│         │         │  ┌──────────────────────┐  │           │
│         │         │  │ 🔍 Search papers...  │  │  ← Glass  │
│         │         │  │                      │  │    Card   │
│         │         │  │ [📚] [✨] [Search →] │  │           │
│         │         │  └──────────────────────┘  │           │
│         │         │                            │           │
│         │         └────────────────────────────┘           │
│         │                                                  │
│         │   ┌──────────────────────────────────────────┐   │
│         │   │              FOOTER                      │   │
│         │   └──────────────────────────────────────────┘   │
└─────────┴──────────────────────────────────────────────────┘
```

**Key Features:**
- Clean, minimal interface
- Large search card with glassmorphism
- Generous whitespace
- Search history in sidebar (not duplicated in main)

### Results Page

```
┌────────────────────────────────────────────────────────────┐
│ SIDEBAR │                                                  │
│         │   ┌──────────────────────────────────────────┐   │
│ + Merged│   │ 🔍 Search input...          [Search]     │   │
│ Filters │   └──────────────────────────────────────────┘   │
│         │   ┌──────────────────────────────────────────┐   │
│         │   │ ❓ Research question...        [Ask]     │   │
│         │   └──────────────────────────────────────────┘   │
│         │                                                  │
│         │   1,234 results  [Screen] [Adjust] [⬇️] [🔗]    │
│         │   ──────────────────────────────────────────     │
│         │                                                  │
│         │   ┌──────────────────────────────────────────┐   │
│         │   │  📄 Result Card 1                        │   │
│         │   │  Title, authors, abstract preview...     │   │
│         │   └──────────────────────────────────────────┘   │
│         │   ┌──────────────────────────────────────────┐   │
│         │   │  📄 Result Card 2                        │   │
│         │   └──────────────────────────────────────────┘   │
│         │   ...                                            │
│         │                                                  │
│         │   [← Prev]  Page 1 of 50  [Next →]              │
│         │                                                  │
│         │   ┌──────────────────────────────────────────┐   │
│         │   │              FOOTER                      │   │
│         │   └──────────────────────────────────────────┘   │
└─────────┴──────────────────────────────────────────────────┘
```

**Key Features:**
- Filters merged into sidebar
- Full-width results area
- Sticky search bars at top
- Action bar with result count

---

## Implementation Plan

### Phase 1: Foundation

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | Update color palette | `app/globals.css` | Pending |
| 2 | Create SidebarProvider | `components/sidebar-provider.tsx` | Pending |
| 3 | Create AppSidebar | `components/app-sidebar.tsx` | Pending |
| 4 | Update root layout | `app/layout.tsx` | Pending |

### Phase 2: Components

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 5 | Update Logo (orange) | `components/logo.tsx` | Pending |
| 6 | Merge SearchSidebar | `components/app-sidebar.tsx` | Pending |
| 7 | Create SettingsDialog | `components/settings-dialog.tsx` | Pending |
| 8 | Redesign home page | `components/PageContent.tsx` | Pending |

### Phase 3: Layouts

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 9 | Update results layout | `app/results/layout.tsx` | Pending |
| 10 | Update results content | `components/results-page-content.tsx` | Pending |
| 11 | Mobile Sheet sidebar | `components/app-sidebar.tsx` | Pending |

### Phase 4: Polish

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 12 | Glassmorphism effects | `app/globals.css` | Pending |
| 13 | Micro-animations | `app/globals.css`, components | Pending |
| 14 | Keyboard shortcuts | `components/sidebar-provider.tsx` | Pending |
| 15 | Remove old navbar | `components/navbar.tsx` | Pending |
| 16 | Final testing | All | Pending |

---

## File Changes Summary

### New Files
- `components/sidebar-provider.tsx` - Sidebar state management
- `components/app-sidebar.tsx` - Main sidebar component
- `components/settings-dialog.tsx` - Settings modal
- `DESIGN.md` - This document

### Modified Files
- `app/globals.css` - New color system
- `app/layout.tsx` - Sidebar integration
- `components/PageContent.tsx` - Home page redesign
- `components/logo.tsx` - Orange branding
- `app/results/layout.tsx` - Remove navbar
- `components/results-page-content.tsx` - Layout changes

### Deprecated Files
- `components/navbar.tsx` - Replaced by sidebar
- `components/search-sidebar.tsx` - Merged into AppSidebar
- `components/ui/conditional-footer.tsx` - Simplified

---

## Notes

- All colors use OKLCH for perceptual uniformity
- Animations use `cubic-bezier(0.4, 0, 0.2, 1)` for natural feel
- Mobile-first responsive approach
- Accessibility: Focus states, keyboard navigation, ARIA labels
- Performance: CSS-only animations where possible
