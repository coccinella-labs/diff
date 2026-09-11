// SPDX-License-Identifier: LicenseRef-DIFF

import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import {
  chromium,
  devices,
  type BrowserContext,
  type Page,
} from "playwright";

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface E2EState {
  authUserId: string | null;
  authEmail: string | null;
  authLoading: boolean;
  authError: string | null;
  preferencesLoading: boolean;
  preferencesSyncing: boolean;
  preferencesSetupHint: string | null;
  theme: "dark" | "midnight" | "grey" | "graphite";
  currentOwner: string;
  currentRepo: string;
  defaultRepo: { owner: string; repo: string };
  recentReposCount: number;
  savedPullsCount: number;
  selectedPullNumber: number | null;
  selectedFileName: string | null;
  selectedRepoFilePath: string | null;
  loadedPullNumbers: number[];
  loadedFilesCount: number;
  reviewDraftPath: string | null;
  repoTargetBranch: string;
  loading: boolean;
  activeTab: "diff" | "discussion" | "checks" | "timeline";
  viewMode: "pulls" | "branches" | "code";
  isSidebarOpen: boolean;
  showUpdates: boolean;
  authMenuOpen: boolean;
  githubWriteEnabled: boolean;
}

interface DraftFlickerSample {
  selectedPath: string | null;
  loading: boolean;
  staleEditorVisible: boolean;
  text: string;
}

declare global {
  interface Window {
    __DIFF_DRAFT_FLICKER__?: {
      timer: number;
      samples: DraftFlickerSample[];
    };
  }
}

type SessionSeed = {
  access_token: string;
  refresh_token: string;
};

type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

type SessionSnapshot = SessionSeed & {
  user?: unknown;
  expires_at?: number | null;
  expires_in?: number | null;
  token_type?: string;
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

const BASE_URL = process.env.DIFF_BASE_URL || "http://localhost:3000";
const PRIMARY_REPO_OWNER = process.env.GITHUB_REPO_OWNER || "coccinella-labs";
const PRIMARY_REPO_NAME = process.env.GITHUB_REPO_NAME || "harper";
const ALT_REPO_OWNER = process.env.DIFF_E2E_ALT_REPO_OWNER || "bniladridas";
const ALT_REPO_NAME = process.env.DIFF_E2E_ALT_REPO_NAME || "diff";
const E2E_SESSION_JSON = process.env.DIFF_E2E_SESSION_JSON;
const E2E_SESSION_FILE = process.env.DIFF_E2E_SESSION_FILE;
const E2E_NO_SESSION = process.env.DIFF_E2E_NO_SESSION === "1";
const DEFAULT_E2E_SESSION_FILE = "/tmp/diff-session.json";
const E2E_LIVE_COMMENT = process.env.DIFF_E2E_LIVE_COMMENT === "1";
const E2E_LIVE_INLINE_REVIEW =
  process.env.DIFF_E2E_LIVE_INLINE_REVIEW === "1";
const E2E_LIVE_INLINE_RANGE =
  process.env.DIFF_E2E_LIVE_INLINE_RANGE === "1";
const E2E_LIVE_REVIEW_EVENT =
  (process.env.DIFF_E2E_LIVE_REVIEW_EVENT as ReviewEvent | undefined) || null;
const E2E_LIVE_CODE_COMMIT = process.env.DIFF_E2E_LIVE_CODE_COMMIT === "1";
const E2E_LIVE_CODE_CREATE = process.env.DIFF_E2E_LIVE_CODE_CREATE === "1";
const E2E_PR_ACTION_OWNER = process.env.DIFF_E2E_PR_ACTION_OWNER || "";
const E2E_PR_ACTION_REPO = process.env.DIFF_E2E_PR_ACTION_REPO || "";
const E2E_PR_ACTION_NUMBER = Number(process.env.DIFF_E2E_PR_ACTION_NUMBER || "");
const E2E_PR_ACTION_EXPECT_FORK =
  process.env.DIFF_E2E_PR_ACTION_EXPECT_FORK === "1";
const E2E_LIVE_DRAFT_FIX = process.env.DIFF_E2E_LIVE_DRAFT_FIX === "1";
const E2E_CODE_COMMIT_OWNER = process.env.DIFF_E2E_CODE_COMMIT_OWNER || ALT_REPO_OWNER;
const E2E_CODE_COMMIT_REPO = process.env.DIFF_E2E_CODE_COMMIT_REPO || ALT_REPO_NAME;
const E2E_CODE_COMMIT_PATH = process.env.DIFF_E2E_CODE_COMMIT_PATH || null;
const E2E_CODE_CREATE_PATH = process.env.DIFF_E2E_CODE_CREATE_PATH || null;
const EXPECT_WRITE_FAILURE = process.env.DIFF_E2E_EXPECT_WRITE_FAILURE === "1";
const SKIP_SIGN_OUT = process.env.DIFF_E2E_SKIP_SIGN_OUT === "1";
const E2E_GITHUB_LOGIN = process.env.DIFF_E2E_GITHUB_LOGIN || null;
const GITHUB_PROVIDER_TOKEN_STORAGE_KEY = "diff_github_provider_token";

const results: CheckResult[] = [];
let anonymousModeRecorded = false;

const record = (status: CheckStatus, name: string, detail: string) => {
  results.push({ status, name, detail });
};

const assertPass = (name: string, condition: boolean, detail: string) => {
  record(condition ? "pass" : "fail", name, detail);
};

const skip = (name: string, detail: string) => {
  record("skip", name, detail);
};

const isOAuthAppAccessRestriction = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("OAuth App access restrictions");

const sessionSeed: SessionSnapshot | null = (() => {
  if (E2E_NO_SESSION) return null;

  const sessionFile = (() => {
    if (E2E_SESSION_FILE) return E2E_SESSION_FILE;
    if (existsSync(DEFAULT_E2E_SESSION_FILE)) return DEFAULT_E2E_SESSION_FILE;
    return null;
  })();

  const sessionSource = (() => {
    if (sessionFile) {
      try {
        return readFileSync(sessionFile, "utf8");
      } catch (error) {
        record(
          "fail",
          "session-json",
          error instanceof Error
            ? `failed to read ${sessionFile}: ${error.message}`
            : `failed to read ${sessionFile}`,
        );
        return null;
      }
    }

    return E2E_SESSION_JSON || null;
  })();

  if (!sessionSource) return null;

  try {
    const parsed = JSON.parse(sessionSource) as SessionSnapshot;
    if (
      parsed.expires_at &&
      parsed.expires_at <= Math.floor(Date.now() / 1000)
    ) {
      record(
        "fail",
        "session-json",
        `${sessionFile ? sessionFile : "DIFF_E2E_SESSION_JSON"} contains an expired Supabase session snapshot. Sign in again and refresh the session file.`,
      );
      return null;
    }
    return parsed;
  } catch (error) {
    record(
      "fail",
      "session-json",
      error instanceof Error
        ? `invalid ${sessionFile ? sessionFile : "DIFF_E2E_SESSION_JSON"}: ${error.message}`
        : `invalid ${sessionFile ? sessionFile : "DIFF_E2E_SESSION_JSON"}`,
    );
    return null;
  }
})();

async function unlockApp(page: Page) {
  const input = page.locator('input[placeholder="?"]');
  if (!(await input.isVisible().catch(() => false))) {
    return;
  }

  const bodyText = (await page.locator("body").textContent()) || "";
  const match = bodyText.match(/(\d+)\s*\+\s*(\d+)/);
  if (!match) {
    throw new Error("Could not parse captcha challenge.");
  }

  const answer = String(Number(match[1]) + Number(match[2]));
  await input.fill(answer);
  await page.waitForFunction(() => !document.body.textContent?.includes("Access Verification"));
}

async function waitForBridge(page: Page) {
  await page.waitForFunction(() => Boolean(window.__DIFF_E2E__), undefined, {
    timeout: 15_000,
  });
}

async function bridge<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ({ method, args }) => {
      const api = window.__DIFF_E2E__;
      if (!api) throw new Error("DIFF e2e bridge unavailable.");
      const fn = (
        api as unknown as Record<string, (...fnArgs: unknown[]) => unknown>
      )[method];
      if (typeof fn !== "function") {
        throw new Error(`DIFF e2e bridge method ${method} unavailable.`);
      }
      return await fn(...args);
    },
    { method, args },
  ) as T;
}

async function getState(page: Page): Promise<E2EState> {
  return bridge<E2EState>(page, "getState");
}

async function openApp(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await unlockApp(page);
  await waitForBridge(page);
}

function getSupabaseStorageKey() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    const projectRef = url.hostname.split(".")[0];
    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

async function waitForState(
  page: Page,
  predicate: (state: E2EState) => boolean,
  timeout = 15_000,
) {
  const started = Date.now();
  let lastState: E2EState | null = null;
  while (Date.now() - started < timeout) {
    const state = await getState(page);
    lastState = state;
    if (predicate(state)) return state;
    await page.waitForTimeout(200);
  }
  throw new Error(
    `Timed out waiting for expected app state. Last state: ${
      lastState ? JSON.stringify(lastState) : "unavailable"
    }`,
  );
}

async function waitForRepoView(
  page: Page,
  owner: string,
  repo: string,
  timeout = 15_000,
) {
  return waitForState(
    page,
    (state) =>
      state.currentOwner === owner &&
      state.currentRepo === repo &&
      !state.authLoading &&
      !state.preferencesLoading,
    timeout,
  );
}

async function ensureRepoWithPulls(page: Page, owner: string, repo: string) {
  await bridge(page, "switchRepo", owner, repo);
  await waitForRepoView(page, owner, repo, 20_000);
  await bridge(page, "reloadPulls");
  const state = await waitForState(
    page,
    (current) =>
      current.currentOwner === owner &&
      current.currentRepo === repo &&
      !current.loading,
    20_000,
  );
  if (state.loadedPullNumbers.length === 0) {
    throw new Error(`Repo ${owner}/${repo} has no loaded pulls for e2e checks.`);
  }
  return state;
}

async function seedSession(page: Page) {
  if (!sessionSeed) {
    if (!anonymousModeRecorded) {
      record(
        "pass",
        "anonymous-mode",
        "no seeded session provided; running anonymous browser coverage",
      );
      anonymousModeRecorded = true;
    }
    return false;
  }

  if (sessionSeed.user) {
    const user = sessionSeed.user;
    const userId =
      typeof user === "object" &&
      user !== null &&
      "id" in user &&
      typeof user.id === "string"
        ? user.id
        : "";

    if (!userId) {
      throw new Error("Seeded Supabase session user id is required.");
    }

    const storageKey = getSupabaseStorageKey();
    if (!storageKey) {
      throw new Error("Could not derive Supabase storage key from VITE_SUPABASE_URL.");
    }
    const {
      provider_token: providerToken,
      provider_refresh_token: providerRefreshToken,
      ...sanitizedSession
    } = sessionSeed;
    await page.context().addInitScript(
      ({ key, session, providerToken, providerTokenKey, userId }) => {
        window.localStorage.setItem(key, JSON.stringify(session));
        if (providerToken) {
          window.localStorage.setItem(
            providerTokenKey,
            JSON.stringify({
              user_id: userId,
              token: providerToken,
            }),
          );
        }
      },
      {
        key: storageKey,
        session: sanitizedSession,
        providerToken: providerToken ?? null,
        providerTokenKey: GITHUB_PROVIDER_TOKEN_STORAGE_KEY,
        userId,
      },
    );
    await page.reload({ waitUntil: "networkidle" });
    await unlockApp(page);
    await waitForBridge(page);
  } else {
    await bridge(page, "setSession", sessionSeed);
  }

  await waitForState(
    page,
    (state) =>
      Boolean(state.authUserId) &&
      !state.authLoading &&
      !state.preferencesLoading &&
      !state.preferencesSyncing,
  );
  record("pass", "auth-seed", "seeded Supabase session into the app");
  return true;
}

async function verifyDesktopFlow(context: BrowserContext) {
  const page = await context.newPage();
  await openApp(page);

  const shellState = await getState(page);
  assertPass("desktop-shell", Boolean(shellState.currentOwner && shellState.currentRepo), "app shell loaded");

  const hasAuth = await seedSession(page);
  if (!hasAuth) {
    const anonymousState = await getState(page);
    assertPass(
      "anonymous-fallback",
      !anonymousState.authUserId && !anonymousState.authLoading,
      "anonymous fallback shell remains usable without a seeded session",
    );
    await page.close();
    return null;
  }

  let state = await getState(page);
  assertPass("signed-in", Boolean(state.authUserId), "signed-in state visible");
  state = await ensureRepoWithPulls(page, PRIMARY_REPO_OWNER, PRIMARY_REPO_NAME);

  await page.locator('[data-e2e="auth-menu-toggle"]').click();
  await page.locator('[data-e2e="auth-menu"]').waitFor({ state: "visible" });
  record("pass", "auth-menu", "account menu opens");

  await page.reload({ waitUntil: "networkidle" });
  await unlockApp(page);
  await waitForBridge(page);
  state = await waitForState(
    page,
    (current) => Boolean(current.authUserId) && !current.authLoading && !current.preferencesLoading,
  );
  assertPass("session-persist", Boolean(state.authUserId), "session persisted after reload");

  const themeCycle: E2EState["theme"][] = ["dark", "midnight", "grey", "graphite"];
  const nextTheme = themeCycle[(themeCycle.indexOf(state.theme) + 1) % themeCycle.length];
  await bridge(page, "setTheme", nextTheme);
  await waitForState(
    page,
    (current) => current.theme === nextTheme && !current.preferencesSyncing,
  );
  assertPass(
    "theme-change",
    (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === nextTheme,
    `theme changed to ${nextTheme}`,
  );

  await page.reload({ waitUntil: "networkidle" });
  await unlockApp(page);
  await waitForBridge(page);
  state = await waitForState(
    page,
    (current) =>
      Boolean(current.authUserId) &&
      !current.authLoading &&
      !current.preferencesLoading &&
      !current.preferencesSyncing,
  );
  if (state.theme === nextTheme) {
    record("pass", "theme-persist", "theme persisted after reload");
  } else {
    record(
      "warn",
      "theme-persist",
      `theme reloaded as ${state.theme}; continuing with remaining app checks`,
    );
  }

  state = await ensureRepoWithPulls(page, PRIMARY_REPO_OWNER, PRIMARY_REPO_NAME);
  const originalRepo = { owner: PRIMARY_REPO_OWNER, repo: PRIMARY_REPO_NAME };
  const primaryPullNumber = state.selectedPullNumber ?? state.loadedPullNumbers[0] ?? null;
  await bridge(page, "setDefaultRepo", ALT_REPO_OWNER, ALT_REPO_NAME);
  await waitForState(
    page,
    (current) =>
      current.defaultRepo.owner === ALT_REPO_OWNER &&
      current.defaultRepo.repo === ALT_REPO_NAME,
  );
  record("pass", "default-repo", `${ALT_REPO_OWNER}/${ALT_REPO_NAME} set as default repo`);

  if (!state.selectedPullNumber && state.loadedPullNumbers[0]) {
    await bridge(page, "selectPull", state.loadedPullNumbers[0]);
    state = await waitForState(
      page,
      (current) => current.selectedPullNumber === state.loadedPullNumbers[0],
    );
  }

  if (!state.selectedPullNumber) {
    record("fail", "selected-pull", "no selected pull available for save/comment checks");
  } else {
    const saveToggle = page.locator('[data-e2e="save-pull-toggle"]');
    const saveLabel = ((await saveToggle.textContent()) || "").trim().toLowerCase();
    if (!saveLabel.includes("saved")) {
      await saveToggle.click();
    }
    await waitForState(
      page,
      (current) => current.savedPullsCount >= 1 && !current.preferencesSyncing,
    );
    record("pass", "save-pull", "selected pull saved");
  }

  await bridge(page, "switchRepo", ALT_REPO_OWNER, ALT_REPO_NAME);
  state = await waitForRepoView(page, ALT_REPO_OWNER, ALT_REPO_NAME);
  assertPass(
    "switch-repo",
    state.currentOwner === ALT_REPO_OWNER && state.currentRepo === ALT_REPO_NAME,
    "repo switched inside the app",
  );

  await page.reload({ waitUntil: "networkidle" });
  await unlockApp(page);
  await waitForBridge(page);
  state = await waitForState(
    page,
    (current) =>
      Boolean(current.authUserId) &&
      !current.authLoading &&
      !current.preferencesLoading &&
      !current.preferencesSyncing,
  );

  state = await waitForState(
    page,
    (current) =>
      current.defaultRepo.owner === ALT_REPO_OWNER &&
      current.defaultRepo.repo === ALT_REPO_NAME,
  );
  assertPass("default-repo-persist", true, "default repo persisted after reload");

  state = await waitForState(
    page,
    (current) => current.recentReposCount >= 1 && !current.preferencesSyncing,
  );
  assertPass("recent-repos-persist", true, "recent repos persisted");

  state = await waitForState(
    page,
    (current) => current.savedPullsCount >= 1 && !current.preferencesSyncing,
  );
  assertPass("saved-pulls-persist", true, "saved pulls persisted");

  if (state.authError) {
    record("fail", "auth-error", state.authError);
  }

  if (E2E_LIVE_COMMENT) {
    state = await ensureRepoWithPulls(page, originalRepo.owner, originalRepo.repo);

    const targetPullNumber = primaryPullNumber ?? state.selectedPullNumber ?? state.loadedPullNumbers[0];
    if (!targetPullNumber) {
      record("fail", "live-comment", "no pull available for comment publishing");
    } else {
      if (state.selectedPullNumber !== targetPullNumber) {
        await bridge(page, "selectPull", targetPullNumber);
        state = await waitForState(
          page,
          (current) =>
            current.currentOwner === originalRepo.owner &&
            current.currentRepo === originalRepo.repo &&
            current.selectedPullNumber === targetPullNumber,
        );
      }

      const commentBody = `DIFF e2e comment ${new Date().toISOString()}`;
      await bridge(page, "submitDiscussionComment", commentBody);
      await page.waitForTimeout(1500);

      const commentsResponse = await fetch(
        `${BASE_URL}/api/pulls/${targetPullNumber}/comments?owner=${originalRepo.owner}&repo=${originalRepo.repo}`,
      );
      const comments = (await commentsResponse.json()) as Array<{ body?: string; user?: { login?: string } }>;
      const matchingComment = comments.find((comment) => comment.body === commentBody);

      if (EXPECT_WRITE_FAILURE) {
        assertPass(
          "live-comment-failure",
          !matchingComment,
          "comment write failure remained visible as no published comment",
        );
      } else {
        assertPass("live-comment", Boolean(matchingComment), "discussion comment published");
        if (matchingComment && E2E_GITHUB_LOGIN) {
          assertPass(
            "live-comment-author",
            matchingComment.user?.login === E2E_GITHUB_LOGIN,
            `comment authored by ${matchingComment.user?.login ?? "unknown"}`,
          );
        }
      }
    }
  } else {
    skip("live-comment", "set DIFF_E2E_LIVE_COMMENT=1 to publish and verify a real PR comment");
  }

  if (E2E_LIVE_INLINE_REVIEW) {
    state = await ensureRepoWithPulls(page, originalRepo.owner, originalRepo.repo);

    const targetPullNumber =
      primaryPullNumber ?? state.selectedPullNumber ?? state.loadedPullNumbers[0];
    if (!targetPullNumber) {
      record(
        "fail",
        "live-inline-review",
        "no pull available for inline review comment",
      );
    } else {
      if (state.selectedPullNumber !== targetPullNumber) {
        await bridge(page, "selectPull", targetPullNumber);
      }

      state = await waitForState(
        page,
        (current) =>
          current.currentOwner === originalRepo.owner &&
          current.currentRepo === originalRepo.repo &&
          current.selectedPullNumber === targetPullNumber &&
          current.loadedFilesCount > 0 &&
          !current.loading,
        20_000,
      );

      const reviewCommentBody = E2E_LIVE_INLINE_RANGE
        ? `DIFF e2e inline range review ${new Date().toISOString()}`
        : `DIFF e2e inline review ${new Date().toISOString()}`;
      let inlineReviewBlocked = false;
      try {
        await bridge(
          page,
          "submitInlineReviewComment",
          reviewCommentBody,
          undefined,
          E2E_LIVE_INLINE_RANGE ? -1 : undefined,
        );
      } catch (error) {
        if (isOAuthAppAccessRestriction(error)) {
          inlineReviewBlocked = true;
          record(
            "warn",
            "live-inline-review",
            "GitHub organization OAuth App access restrictions blocked inline review verification.",
          );
        } else {
          throw error;
        }
      }
      if (!inlineReviewBlocked) {
      await page.waitForTimeout(1500);

      const reviewCommentsResponse = await fetch(
        `${BASE_URL}/api/pulls/${targetPullNumber}/review-comments?owner=${originalRepo.owner}&repo=${originalRepo.repo}`,
      );
      const reviewComments = (await reviewCommentsResponse.json()) as Array<{
        body?: string;
        line?: number;
        start_line?: number | null;
        original_line?: number;
        original_start_line?: number | null;
        user?: { login?: string };
      }>;
      const matchingReviewComment = reviewComments.find(
        (comment) => comment.body === reviewCommentBody,
      );

      if (EXPECT_WRITE_FAILURE) {
        assertPass(
          "live-inline-review-failure",
          !matchingReviewComment,
          "inline review write failure remained visible as no published annotation",
        );
      } else {
        assertPass(
          "live-inline-review",
          Boolean(matchingReviewComment),
          E2E_LIVE_INLINE_RANGE
            ? "multi-line inline review comment published"
            : "inline review comment published",
        );
        if (matchingReviewComment && E2E_LIVE_INLINE_RANGE) {
          const startLine =
            matchingReviewComment.start_line ??
            matchingReviewComment.original_start_line;
          const endLine =
            matchingReviewComment.line ?? matchingReviewComment.original_line;
          assertPass(
            "live-inline-review-range",
            Boolean(startLine && endLine && startLine !== endLine),
            `inline review range ${startLine ?? "unknown"}-${endLine ?? "unknown"}`,
          );
        }
        if (matchingReviewComment && E2E_GITHUB_LOGIN) {
          assertPass(
            "live-inline-review-author",
            matchingReviewComment.user?.login === E2E_GITHUB_LOGIN,
            `inline review authored by ${matchingReviewComment.user?.login ?? "unknown"}`,
          );
        }
      }
      }
    }
  } else {
    skip(
      "live-inline-review",
      "set DIFF_E2E_LIVE_INLINE_REVIEW=1 to publish and verify a real inline review comment",
    );
  }

  if (E2E_LIVE_REVIEW_EVENT) {
    state = await ensureRepoWithPulls(page, originalRepo.owner, originalRepo.repo);

    const targetPullNumber =
      primaryPullNumber ?? state.selectedPullNumber ?? state.loadedPullNumbers[0];
    if (!targetPullNumber) {
      record("fail", "live-review", "no pull available for review submission");
    } else {
      if (state.selectedPullNumber !== targetPullNumber) {
        await bridge(page, "selectPull", targetPullNumber);
      }

      state = await waitForState(
        page,
        (current) =>
          current.currentOwner === originalRepo.owner &&
          current.currentRepo === originalRepo.repo &&
          current.selectedPullNumber === targetPullNumber,
        20_000,
      );

      const reviewBody = `DIFF e2e review ${E2E_LIVE_REVIEW_EVENT} ${new Date().toISOString()}`;
      let reviewBlocked = false;
      try {
        await bridge(
          page,
          "submitReviewAction",
          E2E_LIVE_REVIEW_EVENT,
          reviewBody,
        );
      } catch (error) {
        if (isOAuthAppAccessRestriction(error)) {
          reviewBlocked = true;
          record(
            "warn",
            "live-review",
            "GitHub organization OAuth App access restrictions blocked review submission verification.",
          );
        } else {
          throw error;
        }
      }
      if (!reviewBlocked) {
      await page.waitForTimeout(1500);

      const reviewsResponse = await fetch(
        `${BASE_URL}/api/pulls/${targetPullNumber}/reviews?owner=${originalRepo.owner}&repo=${originalRepo.repo}`,
      );
      const reviews = (await reviewsResponse.json()) as Array<{
        body?: string;
        user?: { login?: string };
      }>;
      const matchingReview = reviews.find((review) => review.body === reviewBody);

      if (EXPECT_WRITE_FAILURE) {
        assertPass(
          "live-review-failure",
          !matchingReview,
          "review write failure remained visible as no submitted review",
        );
      } else {
        assertPass(
          "live-review",
          Boolean(matchingReview),
          `review ${E2E_LIVE_REVIEW_EVENT} submitted`,
        );
        if (matchingReview && E2E_GITHUB_LOGIN) {
          assertPass(
            "live-review-author",
            matchingReview.user?.login === E2E_GITHUB_LOGIN,
            `review authored by ${matchingReview.user?.login ?? "unknown"}`,
          );
        }
      }
      }
    }
  } else {
    skip(
      "live-review",
      "set DIFF_E2E_LIVE_REVIEW_EVENT=COMMENT|APPROVE|REQUEST_CHANGES to verify review submission",
    );
  }

  if (
    E2E_PR_ACTION_OWNER &&
    E2E_PR_ACTION_REPO &&
    Number.isFinite(E2E_PR_ACTION_NUMBER) &&
    E2E_PR_ACTION_NUMBER > 0
  ) {
    await bridge(page, "switchRepo", E2E_PR_ACTION_OWNER, E2E_PR_ACTION_REPO);
    await waitForRepoView(page, E2E_PR_ACTION_OWNER, E2E_PR_ACTION_REPO, 20_000);
    await bridge(page, "reloadPulls");
    await waitForState(
      page,
      (current) =>
        current.currentOwner === E2E_PR_ACTION_OWNER &&
        current.currentRepo === E2E_PR_ACTION_REPO &&
        !current.loading,
      20_000,
    );
    await bridge(page, "selectPull", E2E_PR_ACTION_NUMBER);
    await waitForState(
      page,
      (current) =>
        current.selectedPullNumber === E2E_PR_ACTION_NUMBER &&
        (!E2E_LIVE_DRAFT_FIX || Boolean(current.reviewDraftPath)) &&
        !current.loading,
      20_000,
    );

    await page.waitForFunction(
      async () => {
        const api = window.__DIFF_E2E__;
        if (!api) return false;
        const state = await api.getSelectedPullBranchActions();
        return Boolean(state.headRepo) && (state.canWorkInCode || state.hasReviewDraftTarget);
      },
      undefined,
      { timeout: 10_000 },
    ).catch(() => undefined);

    if (E2E_LIVE_DRAFT_FIX) {
      await page.waitForFunction(
        async () => {
          const api = window.__DIFF_E2E__;
          if (!api) return false;
          const state = await api.getSelectedPullBranchActions();
          return state.hasReviewDraftTarget;
        },
        undefined,
        { timeout: 10_000 },
      ).catch(() => undefined);
    }

    const actionState = await bridge<{
      canWorkInCode: boolean;
      hasReviewDraftTarget: boolean;
      reviewDraftPath: string | null;
      headRepo: string | null;
      headRef: string | null;
    }>(page, "getSelectedPullBranchActions");
    const isForkPull = actionState.headRepo !== `${E2E_PR_ACTION_OWNER}/${E2E_PR_ACTION_REPO}`;

    assertPass(
      "pr-action-fork-state",
      isForkPull === E2E_PR_ACTION_EXPECT_FORK,
      `head repo ${actionState.headRepo ?? "unknown"}`,
    );
    assertPass(
      "pr-action-code-availability",
      E2E_PR_ACTION_EXPECT_FORK ? !actionState.canWorkInCode : actionState.canWorkInCode,
      E2E_PR_ACTION_EXPECT_FORK
        ? "fork PR code action blocked"
        : "same-repo PR code action available",
    );

    try {
      const openResult = await bridge<{ branch: string; path: string | null }>(
        page,
        "openSelectedPullBranchInCode",
      );
      await waitForState(
        page,
        (current) =>
          current.viewMode === "code" &&
          current.selectedPullNumber === E2E_PR_ACTION_NUMBER &&
          current.repoTargetBranch === actionState.headRef &&
          (!openResult.path || current.selectedRepoFilePath === openResult.path),
        20_000,
      );
      assertPass(
        "pr-action-open-code",
        !E2E_PR_ACTION_EXPECT_FORK,
        openResult.path
          ? `selected PR branch opened ${openResult.path} in Code view`
          : "selected PR branch opened in Code view",
      );
    } catch (error) {
      assertPass(
        "pr-action-open-code",
        E2E_PR_ACTION_EXPECT_FORK,
        error instanceof Error ? error.message : "selected PR branch could not open in Code",
      );
    }

    if (actionState.hasReviewDraftTarget) {
      try {
        if (!E2E_LIVE_DRAFT_FIX && !E2E_PR_ACTION_EXPECT_FORK) {
          skip(
            "pr-action-draft-fix",
            "set DIFF_E2E_LIVE_DRAFT_FIX=1 to call Gemini and prepare a real Draft Fix",
          );
        } else {
          await page.evaluate((targetPath) => {
            const samples: Array<{
              selectedPath: string | null;
              loading: boolean;
              staleEditorVisible: boolean;
              text: string;
            }> = [];
            const timer = window.setInterval(() => {
              const state = window.__DIFF_E2E__?.getState();
              const text = document.body.innerText;
              const loading = text.includes("Reading Repository");
              const commitVisible = /\bCOMMIT\b/.test(text);
              const savePrVisible = /\bSAVE PR\b/.test(text);
              samples.push({
                selectedPath: state?.selectedRepoFilePath ?? null,
                loading,
                staleEditorVisible: Boolean(
                  state?.viewMode === "code" &&
                    targetPath &&
                    state.selectedRepoFilePath !== targetPath &&
                    !loading &&
                    (commitVisible || savePrVisible),
                ),
                text: text.slice(0, 400),
              });
            }, 16);

            window.__DIFF_DRAFT_FLICKER__ = { timer, samples };
          }, actionState.reviewDraftPath);
          const draftResult = await bridge<{ path: string; branch: string }>(page, "draftFirstReviewFix");
          await waitForState(
            page,
            (current) =>
              current.viewMode === "code" &&
              current.repoTargetBranch === draftResult.branch &&
              current.selectedRepoFilePath === draftResult.path,
            30_000,
          );
          const flickerSamples = await page.evaluate(() => {
            const monitor = window.__DIFF_DRAFT_FLICKER__;
            if (!monitor) return [];
            window.clearInterval(monitor.timer);
            return monitor.samples;
          });
          const staleSamples = flickerSamples.filter((sample) => sample.staleEditorVisible);
          assertPass(
            "pr-action-draft-fix",
            !E2E_PR_ACTION_EXPECT_FORK,
            "Draft Fix prepared Code view edit",
          );
          assertPass(
            "pr-action-draft-fix-no-stale-editor",
            staleSamples.length === 0,
            staleSamples.length === 0
              ? "Draft Fix did not expose stale commit/PR controls during transition"
              : `stale editor controls appeared in ${staleSamples.length} samples`,
          );
        }
      } catch (error) {
        await page.evaluate(() => {
          const monitor = window.__DIFF_DRAFT_FLICKER__;
          if (monitor) window.clearInterval(monitor.timer);
        }).catch(() => undefined);
        assertPass(
          "pr-action-draft-fix",
          E2E_PR_ACTION_EXPECT_FORK,
          error instanceof Error ? error.message : "Draft Fix blocked",
        );
      }
    } else {
      skip("pr-action-draft-fix", "selected PR has no review comment with a file path");
    }
  } else {
    skip(
      "pr-action-guards",
      "set DIFF_E2E_PR_ACTION_OWNER/REPO/NUMBER to verify Edit Branch and Draft Fix guards",
    );
  }

  if (E2E_LIVE_CODE_COMMIT) {
    if (!E2E_CODE_COMMIT_PATH) {
      record(
        "fail",
        "live-code-commit",
        "DIFF_E2E_CODE_COMMIT_PATH is required when DIFF_E2E_LIVE_CODE_COMMIT=1",
      );
    } else {
      await bridge(page, "switchRepo", E2E_CODE_COMMIT_OWNER, E2E_CODE_COMMIT_REPO);
      await waitForRepoView(page, E2E_CODE_COMMIT_OWNER, E2E_CODE_COMMIT_REPO, 20_000);

      const currentFile = await bridge<{ path: string; content: string; sha: string }>(
        page,
        "getCodeFile",
        E2E_CODE_COMMIT_PATH,
      );
      const marker = `DIFF e2e code commit ${new Date().toISOString()}`;
      const nextContent = `${currentFile.content.replace(/\s*$/, "")}\n\n${marker}\n`;
      const message = `DIFF e2e code commit ${new Date().toISOString()}`;

      try {
        await bridge(page, "commitCodeFile", E2E_CODE_COMMIT_PATH, nextContent, message);
        await page.waitForTimeout(1500);

        const verifyResponse = await fetch(
          `${BASE_URL}/api/repo/content?owner=${E2E_CODE_COMMIT_OWNER}&repo=${E2E_CODE_COMMIT_REPO}&path=${encodeURIComponent(E2E_CODE_COMMIT_PATH)}`,
        );
        const verifiedContent = await verifyResponse.text();

        if (EXPECT_WRITE_FAILURE) {
          assertPass(
            "live-code-commit-failure",
            !verifiedContent.includes(marker),
            "code commit failure remained visible as no file mutation",
          );
        } else {
          assertPass(
            "live-code-commit",
            verifiedContent.includes(marker),
            `code file ${E2E_CODE_COMMIT_PATH} committed`,
          );
        }
      } catch (error) {
        if (EXPECT_WRITE_FAILURE || isOAuthAppAccessRestriction(error)) {
          record(
            EXPECT_WRITE_FAILURE ? "pass" : "skip",
            EXPECT_WRITE_FAILURE ? "live-code-commit-failure" : "live-code-commit",
            error instanceof Error ? error.message : "code commit rejected",
          );
        } else {
          record(
            "fail",
            "live-code-commit",
            error instanceof Error ? error.message : "code commit failed",
          );
        }
      }
    }
  } else {
    skip(
      "live-code-commit",
      "set DIFF_E2E_LIVE_CODE_COMMIT=1 and DIFF_E2E_CODE_COMMIT_PATH to publish and verify a real file commit",
    );
  }

  if (E2E_LIVE_CODE_CREATE) {
    if (!E2E_CODE_CREATE_PATH) {
      record(
        "fail",
        "live-code-create",
        "DIFF_E2E_CODE_CREATE_PATH is required when DIFF_E2E_LIVE_CODE_CREATE=1",
      );
    } else {
      await bridge(page, "switchRepo", E2E_CODE_COMMIT_OWNER, E2E_CODE_COMMIT_REPO);
      await waitForRepoView(page, E2E_CODE_COMMIT_OWNER, E2E_CODE_COMMIT_REPO, 20_000);

      const marker = `DIFF e2e code create ${new Date().toISOString()}`;
      const message = `DIFF e2e code create ${new Date().toISOString()}`;

      try {
        await bridge(page, "createCodeFile", E2E_CODE_CREATE_PATH, `${marker}\n`, message);
        await page.waitForTimeout(1500);

        const verifyResponse = await fetch(
          `${BASE_URL}/api/repo/content?owner=${E2E_CODE_COMMIT_OWNER}&repo=${E2E_CODE_COMMIT_REPO}&path=${encodeURIComponent(E2E_CODE_CREATE_PATH)}`,
        );
        const verifiedContent = await verifyResponse.text();

        if (EXPECT_WRITE_FAILURE) {
          assertPass(
            "live-code-create-failure",
            !verifiedContent.includes(marker),
            "code create failure remained visible as no file mutation",
          );
        } else {
          assertPass(
            "live-code-create",
            verifiedContent.includes(marker),
            `code file ${E2E_CODE_CREATE_PATH} created`,
          );
        }
      } catch (error) {
        if (EXPECT_WRITE_FAILURE || isOAuthAppAccessRestriction(error)) {
          record(
            EXPECT_WRITE_FAILURE ? "pass" : "skip",
            EXPECT_WRITE_FAILURE ? "live-code-create-failure" : "live-code-create",
            error instanceof Error ? error.message : "code create rejected",
          );
        } else {
          throw error;
        }
      }
    }
  } else {
    skip(
      "live-code-create",
      "set DIFF_E2E_LIVE_CODE_CREATE=1 and DIFF_E2E_CODE_CREATE_PATH to publish and verify a real file create",
    );
  }

  await page.close();
}

async function verifyMobileFlow() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const page = await context.newPage();

  await openApp(page);
  const state = await getState(page);
  assertPass("mobile-shell", Boolean(state.currentOwner && state.currentRepo), "mobile shell loaded");

  const hasAuth = await seedSession(page);
  if (!hasAuth) {
    const anonymousState = await getState(page);
    assertPass(
      "mobile-anonymous-fallback",
      !anonymousState.authUserId && !anonymousState.authLoading,
      "mobile anonymous fallback shell remains usable without a seeded session",
    );
    await browser.close();
    return;
  }

  await waitForState(
    page,
    (current) => Boolean(current.authUserId) && !current.authLoading && !current.preferencesLoading,
  );
  await bridge(page, "openAuthMenu");
  await page.locator('[data-e2e="auth-menu"]').waitFor({ state: "visible" });
  record("pass", "mobile-auth-menu", "mobile auth menu is accessible");

  await bridge(page, "openUpdates");
  await page.locator('[data-e2e="updates-modal"]').waitFor({ state: "visible" });
  record("pass", "mobile-updates", "mobile updates modal opens");
  await bridge(page, "closeUpdates");

  await bridge(page, "openSidebar");
  await page.locator('[data-e2e="sidebar-account"]').waitFor({ state: "visible" });
  record("pass", "mobile-sidebar-account", "mobile sidebar account surface visible");

  const mobileState = await getState(page);
  if (mobileState.savedPullsCount > 0) {
    await page.locator('[data-e2e="sidebar-saved-pulls"]').waitFor({ state: "visible" });
    record("pass", "mobile-saved-pulls", "mobile saved pulls surface visible");
  } else {
    skip("mobile-saved-pulls", "no saved pulls present in the authenticated state");
  }

  await browser.close();
}

async function main() {
  if (results.some((result) => result.name === "session-json" && result.status === "fail")) {
    printSummary();
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    record(
      "fail",
      "playwright-launch",
      error instanceof Error
        ? `${error.message}. Run: npx playwright install chromium`
        : "failed to launch Playwright browser",
    );
    printSummary();
    process.exit(1);
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await verifyDesktopFlow(context);
    await context.close();
    await browser.close();
    await verifyMobileFlow();

    if (SKIP_SIGN_OUT) {
      skip("sign-out", "DIFF_E2E_SKIP_SIGN_OUT=1 keeps the session reusable for live write checks");
      skip(
        "signed-out-fallback",
        "DIFF_E2E_SKIP_SIGN_OUT=1 skips fallback verification",
      );
    } else {
      const desktopSignOutBrowser = await chromium.launch({ headless: true });
      const desktopSignOutContext = await desktopSignOutBrowser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const signOutPage = await desktopSignOutContext.newPage();
      await openApp(signOutPage);
      const hasAuth = await seedSession(signOutPage);
      if (!hasAuth) {
        const anonymousState = await getState(signOutPage);
        assertPass(
          "signed-out-fallback",
          !anonymousState.authUserId && !anonymousState.authLoading,
          "anonymous fallback remains usable without a seeded session",
        );
      } else {
        await bridge(signOutPage, "signOut");
        const state = await waitForState(
          signOutPage,
          (current) => !current.authUserId && !current.authLoading,
        );
        assertPass("sign-out", !state.authUserId, "signed out via app bridge");
        if (sessionSeed?.user) {
          skip(
            "signed-out-fallback",
            "snapshot seeding rehydrates auth on reload; fallback needs a manual or OAuth-driven session run",
          );
        } else {
          await signOutPage.reload({ waitUntil: "networkidle" });
          await unlockApp(signOutPage);
          await waitForBridge(signOutPage);
          const signedOutState = await waitForState(
            signOutPage,
            (current) => !current.authUserId && !current.authLoading,
          );
          assertPass(
            "signed-out-fallback",
            !signedOutState.authUserId,
            "anonymous fallback remains usable after sign out",
          );
        }
      }
      await desktopSignOutBrowser.close();
    }
  } catch (error) {
    record("fail", "check-e2e", error instanceof Error ? error.message : "unknown e2e error");
    if (browser) {
      await browser.close();
    }
  }

  printSummary();
  process.exit(results.some((result) => result.status === "fail") ? 1 : 0);
}

function printSummary() {
  const passing = results.filter((result) => result.status === "pass").length;
  const skipped = results.filter((result) => result.status === "skip").length;
  const failing = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;

  console.log(`\nDIFF browser e2e check against ${BASE_URL}\n`);
  for (const result of results) {
    console.log(`${result.status.toUpperCase().padEnd(4, " ")}  ${result.name}  ${result.detail}`);
  }
  console.log(`\nSummary: ${passing} pass, ${warned} warn, ${skipped} skip, ${failing} fail`);
}

main();
