---
name: verify
description: Prove an OpenScholar change in real browsers with `npm run verify`. Use whenever a change touches anything a person sees (app/, components/, styles), when reproducing a visual, loading or layout bug, and before saying UI work is done. Starts this worktree's app, signs in, checks that pages hold still in Chromium and Firefox with slow data, compares with dev.openscholar.ai, and stops what it started.
---

# Verify

`npm run verify` runs the app from this worktree and drives it the way a person does. It replaces hand-written Playwright scripts: use it instead of building your own.

## Commands

```bash
npm run verify -- up --prod          # build and start this worktree on its own port (about 30 s)
npm run verify -- shift /library     # check a page, signed in, in Chromium and Firefox
npm run verify -- shift /extraction --do "click text=Recent" --do "press Escape"
npm run verify -- shot /settings/ai  # screenshots only
npm run verify -- status             # what is running, and whether the environment is ready
npm run verify -- down               # stop the server this worktree started
npm run verify -- skip "<reason>"    # record why a change needs no browser check
```

`npm run verify` with no command prints every option.

## How to prove a change

1. `up --prod`. Use plain `up` (next dev) only while iterating; `shift` compares with the production build on dev.openscholar.ai, and dev mode's slower hydration shows problems production doesn't have.
2. Run `shift` on every route your change affects. Add a `--do` step for each interaction you changed: the dialog you made, the tab you restyled, the filter you added. Steps are `click`, `hover`, `fill <selector> <text>`, `press <key>`, `wait <ms>`, `goto <path>`, with Playwright selectors (`text=Save`, `role=button[name="Save"]`, CSS).
3. Fix every problem listed under `Fail`, then run `shift` again. After a code change on a `--prod` server, run `down` and `up --prod` again so the build includes it.
4. Look at the screenshots it lists. `shift` proves the page holds still, not that it looks right.
5. `down` when you are done, unless the user wants to look at it. Then give them the link from `status`; `up --open` opens it in their browser once.

## Reading the result

`shift` loads the page with every server message delayed by 600 ms, records each animation frame, and reports:

- **layout shift**: an element moved or resized after the page settled. Transforms and opacity never count, so fades and slides are fine. A wrapper growing around new content only counts when it draws a background, border or shadow.
- **text disappeared and came back** or **showed for only N ms**: a flash.
- **element showed for only N ms**: a blink. A placeholder replaced in the same place and size is fine.
- **uncaught error** and **never settled**.

Then it runs the same steps on dev.openscholar.ai, with the same Convex data and Clerk instance. Only problems dev doesn't have fail the run. The ones dev also has are listed as not from this branch: leave them unless the user asked for them, and mention them in your report.

If a step can't run on dev (it clicks something your branch adds), everything after it counts as new. If you're sure an element's movement is intended (a panel that expands when clicked), pass `--allow <selector>` and say so in your report.

## Signing in

`shift` and `shot` sign in as `verify-agent+clerk_test@example.com`, a member of the "Verify Agent" organization, which has Evidence Libraries, authors and extraction turned on. `verify` creates both on first use. To check a page with another account's data, pass `--as <email>` with an existing development user. `--anon` skips sign-in.

## The stop hook

A global stop hook runs `npm run verify -- hook stop` when an agent tries to finish. If files under `app/` or `components/` (`.tsx`, `.css`) changed in this session and no `shift` has passed since, it sends the agent back with the files to check. If nothing a person sees changed, or the user said not to test, run `skip "<reason>"` and give the same reason in your reply.

## Files

- `scripts/verify/cli.ts`: the commands and the in-page recorder.
- `scripts/verify/analysis.ts`: what counts as a problem (tested in `tests/verify.test.ts`).
- `.verify/` (ignored): the server's pid and log, run reports and screenshots, and the last pass.
