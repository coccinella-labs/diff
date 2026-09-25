<!-- SPDX-License-Identifier: LicenseRef-DIFF -->

# Privacy Policy

Last updated: 2026-05-11

DIFF is a browser-based pull request review tool provided by Coccinella Labs Inc. This policy explains what information DIFF uses when you sign in with GitHub through Supabase.

## Information DIFF Uses

- GitHub account identity returned through Supabase Auth, such as username, email, avatar, and provider identifiers.
- GitHub OAuth provider tokens needed to read GitHub data and publish authenticated GitHub actions you request.
- Pull request and repository data loaded from GitHub for the repositories you open in DIFF.
- File content and review comment text sent to Gemini only when you request an AI draft fix.
- User preferences stored in Supabase, including theme, default repository, recent repositories, saved pull requests, and saved AI drafts.
- Local browser storage for session state, the GitHub provider token cache, theme, default repository, and policy acknowledgement.

## How DIFF Uses Information

DIFF uses this information to sign you in, show PR data, sync preferences, restore recent state, and publish GitHub changes you choose.

Authenticated reads and writes are sent to GitHub as the signed-in user when needed for private repository access or actions you request. Writes can include comments, reviews, commits, branches, PRs, PR metadata, and labels. DIFF does not sell personal information.

AI draft fixes are optional. When used, DIFF sends the selected file content and review comment to Gemini and opens the draft in Code view for manual review before commit. Saved AI drafts remain in Supabase until you delete them.

## Third-Party Services

DIFF depends on GitHub for repository data and OAuth authorization, Supabase for authentication and synced user preferences, and Gemini for optional AI draft fixes. Those services process information under their own terms and policies.

## Retention And Control

Browser-local data can be cleared from your browser storage. Synced preferences and saved AI drafts are stored in Supabase under your authenticated user id. GitHub OAuth access can be revoked from your GitHub account settings.

## Contact

For project questions, use the repository issue tracker or Coccinella Labs project space:

- https://github.com/coccinella-labs/diff
- https://github.com/Coccinella-Labs/coccinella
