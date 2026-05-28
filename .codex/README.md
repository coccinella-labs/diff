## Repo Notes

Last updated: 2026-05-28

Release line:

- `v0.7.5` Icon Polish
- `v0.7.4` Check Logs
- `v0.7.3` Schema Cleanup
- `v0.7.2` Loading Cleanup
- `v0.7.1` UI Cleanup
- `v0.7.0` Review Drafts
- `v0.6.2` Icon Polish
- `v0.6.1` Pull Stream Fixes
- `v0.6.0` Code PR Workspace
- `v0.5.0` Code Branches
- `v0.4.0` Live Code Workspace
- `v0.3.5` Sign-In Trust Update
- `v0.3.4` Sign-In & Check Polish
- `v0.3.3` Branch History & Mobile Annotations
- `v0.3.2` Mobile Review Navigation
- `v0.3.1` State & Interface Refinements
- `v0.3.0` Supabase Auth & User State
- `v0.2.2` Mobile History & Changelog Polish
- `v0.2.1` History, Checks & Navigation Refinements
- `v0.2.0` Review API & CI Surfaces
- `v0.1.2` Theme Switch & UI Cleanup
- `v0.1.1` Checks, Navigation & App Flow
- `v0.1.0` Core Diff Engine

Keep `src/constants/updates.ts` aligned with tags and GitHub releases.

Keep a compact `Next` entry at the end of the in-app `Updates` feed. When bumping, move completed work into the released version entry and leave `Next` as a light holding place for the next pass.

Keep update and release-note copy calm, compact, and non-pushy. Prefer maintenance-style wording such as "polish", "cleanup", "quieter", or "more consistent" when accurate; avoid marketing-heavy phrasing for routine fixes.

`VERSION` and `package.json` must match for each release.

Release tags use `v`-prefixed SemVer. Example: tag `v0.7.5`, version `0.7.5`.

Each stable tag needs a matching release branch at the same commit. Example: `release/0.7.5` points at `v0.7.5`.

When bumping a release, update all version-bearing release files together:

- `package.json`
- `package-lock.json`
- `VERSION`
- `src/constants/updates.ts`
- `.codex/README.md`
- `scripts/generate-release-notes.ts` examples and error text
- `docs/workflows.md` release examples

Use the repo-local bump helper so these files stay aligned:

```bash
npm run bump:release -- patch --title "Release Title" --description "Short release description." --category fix --detail "First change" --detail "Second change"
```

After bumping, run `node --import tsx ./scripts/generate-release-notes.ts vX.Y.Z /tmp/diff-release-notes.md` and confirm it compares the previous release tag to the new tag.

Supabase auth expects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the local environment.

Supabase GitHub login in this repo uses a GitHub OAuth App, not a GitHub App. The callback URL registered in GitHub must be the Supabase auth callback for the project.

Per-user app state syncs through `public.user_preferences`. Related migrations:

- `supabase/migrations/20260508_create_user_preferences.sql`
- `supabase/migrations/20260508_extend_user_preferences_saved_state.sql`
- `supabase/migrations/20260512_extend_user_preferences_ai_drafts.sql`

The base preferences migration now includes theme, default repo, recent repos, saved pulls, and saved AI drafts. Older preference migrations stay in the repo for projects that already ran them.

GitHub reads and writes use the Supabase GitHub provider token when a user is signed in. The `repo read:user user:email` scopes support private PR detail reads plus comments, reviews, Code view edits and creates, branch creation/deletion, PR creation, branch updates, PR merge/squash/rebase, PR metadata edits, and labels. Saved Gemini drafts live in `user_preferences.ai_drafts` until the user deletes them.

The browser verifier runs anonymous coverage without a seeded session. For authenticated checks, use `window.__DIFF_E2E__.writeSessionFile()` in dev mode, then run with `DIFF_E2E_SESSION_FILE=/tmp/diff-session.json`. `DIFF_E2E_SESSION_JSON` remains available when a file cannot be used.

If a seeded e2e run skips `signed-out-fallback`, that is expected. Snapshot seeding rehydrates auth on reload; full signed-out reload verification still needs a manual or OAuth-driven path.

`npm run check:app` treats authenticated preference and write checks as optional unless `DIFF_REQUIRE_AUTH_CHECKS=1` is set with `DIFF_SUPABASE_ACCESS_TOKEN` and `DIFF_GITHUB_PROVIDER_TOKEN`.

`npm run check:e2e` keeps live write actions opt-in. Code view edit verification requires `DIFF_E2E_LIVE_CODE_COMMIT=1` and `DIFF_E2E_CODE_COMMIT_PATH`; new-file verification requires `DIFF_E2E_LIVE_CODE_CREATE=1` and `DIFF_E2E_CODE_CREATE_PATH`. Use sandbox files because these create real GitHub commits.

Live pull refresh uses `/api/live` WebSockets on a long-running Node server. Serverless deployments fall back to timed HTTP refresh. `npm run check:app` includes a local `live-channel` assertion.

Code view uses `/api/repo/tree` and `/api/repo/content`. Signed-in file edits and creates use `PUT /api/repo/content` with an explicit commit message; existing-file edits include the current file SHA, while new-file creates omit it. Branch and PR flows use `/api/repo/branch`, `/api/pulls`, `/api/pulls/:number`, `/api/pulls/:number/update-branch`, `/api/pulls/:number/merge`, `/api/pulls/:number/head-branch`, and `/api/pulls/:number/labels`. Conflict resolution and PR branch editing in Code view are same-repo only; fork PRs should stay on GitHub or switch to a future explicit fork workspace. Optional Gemini review-fix drafts use `POST /api/ai/review-fix` with `GEMINI_API_KEY`; drafts must be reviewed and committed manually. `npm run check:app` covers these route guards.

The current icon polish release is part of `v0.7.5`.

The strongest local verification sequence before release is:

```bash
npm run lint
pre-commit run --show-diff-on-failure --color=always --all-files
npm run check:app
npm run check:e2e
```

GitHub release automation is handled by `.github/workflows/release.yml` and requires `contents: write` so tag pushes can publish releases and upload `dist/*`.

Nightly prereleases are handled by `.github/workflows/nightly-prerelease.yml`.

- Scheduled runs stay dormant until the repo variable `ENABLE_NIGHTLY_RELEASES` is set to `true`.
- `workflow_dispatch` can be used to validate the prerelease flow without turning on the nightly schedule.
- Nightly prereleases are marked as prereleases and do not become the repo's latest stable release.
