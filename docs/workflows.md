<!-- SPDX-License-Identifier: LicenseRef-DIFF -->

# GitHub Automation

This repository uses GitHub Actions for validation and release work.

## Workflows

- `workflows/typescript-check.yml`
  Runs the baseline validation on pushes to `main` and pull requests:
  - lockfile-based dependency install with `npm ci`
  - `npm run lint`
  - workflow YAML lint
  - `pre-commit` hooks

- `workflows/app-check.yml`
  Runs the app-level read-only verification on pushes to `main`, pull requests, and manual dispatch:
  - lockfile-based dependency install with `npm ci`
  - `npm run lint`
  - Playwright Chromium install
  - starts the local app server
  - runs `npm run check:app`, including the local `/api/live` WebSocket subscription check, repository tree/content route checks, and AI draft auth guard
  - runs `npm run check:e2e`

  This workflow is read-only. It does not seed a Supabase session or publish GitHub writes. Without a seeded session, `check:e2e` runs anonymous browser coverage. Without auth tokens, `check:app` treats authenticated checks as optional; set `DIFF_REQUIRE_AUTH_CHECKS=1` when a secret-backed environment must enforce them.

- `workflows/release.yml`
  Builds and publishes a GitHub release when a `v*` tag is pushed. The release generator validates that the tag is a `v`-prefixed Semantic Versioning 2.0.0 value, such as `v0.7.5`, `v1.0.0`, or `v1.0.0-rc.1`.
  - lockfile-based dependency install with `npm ci`
  - `npm run lint`
  - `npm run build`
  - generates release notes from `src/constants/updates.ts`
  - publishes `dist/*` with the generated release body

- `workflows/nightly-prerelease.yml`
  Builds and publishes nightly prereleases. Scheduled runs stay dormant until the repo variable `ENABLE_NIGHTLY_RELEASES` is set to `true`.
  - computes a nightly tag and title
  - lockfile-based dependency install with `npm ci`
  - `npm run lint`
  - `npm run build`
  - publishes `dist/*` as a prerelease without marking it latest

## Notes

- Release publishing requires `contents: write`.
- Git tags use the common `v` prefix, but the semantic version is the value after `v`. For example, `v0.7.5` is the tag name and `0.7.5` is the SemVer value.
- While DIFF is in `0.y.z`, releases are still initial-development releases. PATCH versions are used for fixes and narrow refinements, MINOR versions are used for larger backward-compatible additions, and prerelease identifiers such as `-rc.1` may be used before a stable cut.
- The app checks use `GITHUB_TOKEN` for GitHub API reads. If the default workflow token is not sufficient for the repo targets DIFF is reading, move that workflow to a dedicated secret-backed token.
- Authenticated browser flows and live GitHub writes are verified manually or through local seeded `check:e2e` runs, not in default CI.
- Strict authenticated route checks require `DIFF_REQUIRE_AUTH_CHECKS=1`, `DIFF_SUPABASE_ACCESS_TOKEN`, and `DIFF_GITHUB_PROVIDER_TOKEN`.
