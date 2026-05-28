<!-- SPDX-License-Identifier: LicenseRef-DIFF -->

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/bniladridas/diff/main/assets/diff-sign-light.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/bniladridas/diff/main/assets/diff-sign.png">
    <img src="https://raw.githubusercontent.com/bniladridas/diff/main/assets/diff-sign.png" alt="DIFF logo" width="36" height="36">
  </picture>
</p>

# DIFF

DIFF is a small app for reading pull requests from GitHub. It keeps the changed files, comments, checks, and branch work close together.

You can browse pull requests and repository files, sign in with GitHub for write actions, sync your app state with Supabase, and use optional Gemini drafts for review fixes.

GitHub writes use the signed-in user's GitHub account. Signed-in users can publish reviews, edit files, create branches, open pull requests, update pull requests, manage labels, update branches, merge pull requests, and delete merged head branches.

Setup details live in these docs:

- [docs/auth/supabase-github.md](docs/auth/supabase-github.md) for Supabase and GitHub sign-in
- [supabase/migrations/20260508_create_user_preferences.sql](supabase/migrations/20260508_create_user_preferences.sql) for the backing preference schema
- [.codex/README.md](.codex/README.md) for repo-local release and workflow notes

DIFF is not an official GitHub product or an official product of any repository owner whose data it reads. Keep local credentials private.
