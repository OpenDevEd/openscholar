# Plan 04: essential configuration fields

## Goal

Let the owner edit only the fields approved in issue #32.

## Fields

- Identity: `identity.name` and `identity.shortName`.
- Public address: `identity.baseUrl`, generated from the runtime binding and shown read-only.
- Assets: `identity.assets.logoDark`, optional `logoLight`, and `favicon` as URL fields supported by the runtime schema.
- Branding: `theme.colors.accent` and `theme.colors.tertiary`, labelled Accent and Secondary.
- Languages: `localization.locales` and `localization.defaultLocale` from the generated locale catalog.

File upload is not part of this issue. Do not invent an asset-storage service behind the URL fields.

## Design

Use the pinned schema and catalogs for limits, URI checks, colour formats, and locale options. Use named React components for the three field groups. Do not build a general schema-form renderer.

The default language must always be one of the selected languages. The form shows a clear field error before save when that rule fails.

## Test-first steps

1. Test schema-derived limits and the language relationship.
2. Add reusable labelled field and error components only where the repository does not already have them.
3. Add the identity and read-only address fields.
4. Add logo, favicon, and colour fields.
5. Add the locale picker and default-language field.
6. Test keyboard use, accessible errors, and owner-only editing.

## Files

- `components/evidence-libraries/configuration/`
- `lib/evidence-libraries/configuration/`
- component and pure behavior tests
- locale files touched by the fields

## Tests

```sh
npm test -- lib/evidence-libraries/configuration tests/components/evidence-libraries
npx tsc --noEmit
npm run dev
```

## Completion

Every approved field renders from the real contract. Invalid values show linked errors. No deferred field, raw JSON editor, fake option, or secret appears.
