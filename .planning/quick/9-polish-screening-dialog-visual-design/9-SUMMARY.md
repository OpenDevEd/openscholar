---
task: "Polish create-collection inline flow"
date: "2026-03-09"
one_liner: "Redesigned inline create-collection card with FolderPlus icon, primary-tinted border, larger buttons with X/Check icons, and i18n 'Create' label across 6 locales"
commits:
  - hash: "79fce1e"
    message: "feat(quick-9): polish create-collection inline flow with icon, primary border, and styled buttons"
files_changed:
  - components/screening/collection-selector.tsx
  - messages/en-US.json
  - messages/en-GB.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
---

# Quick Task 9: Polish create-collection inline flow

## What Changed

- **Visual identity**: Added `FolderPlus` icon in a primary-tinted icon box (`bg-primary/10`) with "Create new collection" heading — clearly signals you're in creation mode
- **Primary border**: Card now uses `border-primary/20 bg-primary/5` instead of generic muted — visually distinct from other form sections
- **Larger, clearer buttons**: Cancel button has `X` icon, Create button has `Check` icon — both h-8 with proper padding instead of tiny h-7
- **Separate confirm label**: New `createCollectionConfirm` i18n key ("Create" / "Créer" / "बनाएं" / "作成" / "创建") instead of reusing the longer "Create new collection" text on the button
- **Input bumped to h-9**: Slightly taller for better touch target and visual weight
