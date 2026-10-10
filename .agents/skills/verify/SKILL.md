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

1. `up --prod`. Use plain `up` (next dev) only while iterating; `shift` compares with the production build on dev.openscholar.ai, and dev mode's slower hydration shows problems production doesn't have. After you change code, `up --prod` again rebuilds; `shift` refuses a production build older than the code.
2. Run `shift` on every route your change affects. Add a `--do` step for each interaction you changed: the dialog you made, the tab you restyled, the filter you added. Steps are `click`, `hover`, `fill <selector> => <text>`, `press <key>`, `wait <ms>`, `goto <path>`, with Playwright selectors (`text=Save`, `role=button[name="Save"]`, CSS). Steps run in each browser and again on dev.openscholar.ai, so give `shift` interactions that save nothing (open, type, switch, navigate). Check a flow that creates or deletes once, with `--browser chromium --base none`.
3. Fix every problem listed under `Fail`, then `up --prod` and `shift` again.
4. Look at the screenshots it lists. `shift` proves the page holds still, not that it looks right.
5. `down` when you are done, unless the user wants to look at it. Then give them the link from `status`; `up --open` opens it in their browser once.

## Reading the result

`shift` loads the page with every server message delayed by 600 ms, records each animation frame, and reports:

- **layout shift**: an element moved or resized after the page settled, measured within its container: content carried along by a moving container is reported once, as the container. Transforms and opacity never count, so fades and slides are fine, and neither does an element moving through its own CSS transition (a switch's thumb). An element that draws no background, border or shadow counts only when it moves, never when it resizes: a wrapper growing around new content is seen through the content and the elements it pushes.
- **text disappeared and came back** or **showed for only N ms**: a flash. A number counting up or down in place is fine.
- **element showed for only N ms**: a blink. A placeholder replaced in the same place and size is fine.
- **popped in N ms after its dialog opened**: something arrived inside a dialog, sheet, popover or menu after it had opened, without fading or sliding in. It read its data only once it was open. Have the data there when it opens: read it where the trigger is, which is mounted while the overlay is shut, and pass it in. What can only come later, such as search results, fades in or is uncovered by a frame that grows. Judged in the step that opens the overlay, so give `shift` a `--do` step that opens each one you changed.
- **uncaught error** and **never settled**.

Then it runs the same steps on dev.openscholar.ai, with the same Convex data and Clerk instance. A problem fails the run only when dev doesn't have it and it shows again on a second run of this branch: a race during loading comes and goes, and is printed as a note instead. The ones dev also has are listed as not from this branch: leave them unless the user asked for them, and mention them in your report.

If a step can't run on dev (it clicks something your branch adds), everything after it counts as new. If you're sure an element's movement is intended (a panel that expands when clicked), pass `--allow <selector>` and say so in your report.

## Signing in

`shift` and `shot` sign in as `verify-agent+clerk_test@example.com`, a member of the "Verify Agent" organization, which has Evidence Libraries, authors and extraction turned on. Its data is its own, so a check never touches a real person's records. `verify` creates both on first use, then stops and asks you to run the command again: Clerk takes a few seconds to send them to Convex. On shared dev the verify user is also an OpenScholar admin, so `/settings/admin` opens, and its organization owns a draft Evidence Library, "Verify Agent Library" (`/evidence-libraries/r1706p6pdaz0wbdpc0yk3x33bs8fyan0/configuration`), that was never set up, so configuration can be checked without a running library. To check a page with another account's data, pass `--as <email>` with an existing development user. `--anon` skips sign-in. Its own library has a collection, "Verify overlays": click it on `/library` to get an open collection's Activity, Move and Share ("Share this collection") buttons.

## The stop hook

A stop hook runs `npm run verify -- hook stop` when an agent tries to finish. It lives on the user's machine, not in this repository: `~/.agents/hooks/verify-stop.sh`, registered for Stop in `~/.claude/settings.json`, `~/.claudeekitabu/settings.json` and `~/.codex/hooks.json` (trusted through Codex's `/hooks`). If files under `app/` or `components/` changed (`.tsx` and `.css`, and `.ts` beside components) in this session and no `shift` has passed since, it sends the agent back with the files to check. It also sends the agent back when a changed file holds a dialog, sheet, popover or menu and the passing `shift` opened none. If nothing a person sees changed, or the user said not to test, run `skip "<reason>"` and give the same reason in your reply.

## Files

- `scripts/verify/cli.ts`: the commands. This one is OpenScholar's own.
- `scripts/verify/analysis.ts`, `recorder.ts`, `browser.ts`, `compare.ts`, `hook.ts` and `util.ts`: the same files as the Evidence Library's `tools/verify` (OpenDevEd/new-el); keep the two in step. `analysis.ts` decides what counts as a problem (tested in `tests/verify.test.ts`); `recorder.ts` runs in the page.
- `.verify/` (ignored): the server's pid and log, run reports and screenshots, and the last pass.
