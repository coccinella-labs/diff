/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Children,
  isValidElement,
  useCallback,
  useDeferredValue,
  useState,
  useEffect,
  useMemo,
  useRef,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { type Session, type User as SupabaseUser } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "motion/react";
import {
  GitBranch,
  ChevronRight,
  ExternalLink,
  FileCode,
  Activity,
  RefreshCw,
  Code,
  MessageSquare,
  MessageCircle,
  Hash,
  Maximize2,
  Minimize2,
  CheckCircle2,
  XCircle,
  Circle,
  CircleSlash,
  Terminal,
  AlertCircle,
  FileText,
  FileArchive,
  FileImage,
  FileJson,
  History,
  GitCommit,
  User,
  CheckCircle,
  ArrowRight,
  ArrowLeftRight,
  Box,
  Palette,
  Settings,
  Search,
  Database,
  Globe,
  Lock,
  Package,
  Sheet,
  Shield,
  Binary,
  Layout,
  LogOut,
  Bookmark,
  Trash2,
  Sparkles,
} from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-go";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-java";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import { cn } from "./lib/utils";
import diffLogoUrl from "../assets/diff-sign-light.png";
import {
  fetchUserPreferences,
  isSupabaseConfigured,
  isMissingUserPreferencesTableError,
  type AiDraftPreference,
  type RecentRepoPreference,
  type SavedPullPreference,
  supabase,
  type ThemePreference,
  upsertUserPreferences,
} from "./lib/supabase";
import ReactMarkdown from "react-markdown";
import { APP_UPDATES } from "./constants/updates";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface GithubComment {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string;
  created_at: string;
  path?: string; // for review comments
  html_url?: string;
  line?: number;
  original_line?: number;
  start_line?: number;
  original_start_line?: number;
  side?: "LEFT" | "RIGHT";
  start_side?: "LEFT" | "RIGHT";
  position?: number; // diff position, not a file line
  original_position?: number;
}

type PullStateFilter = "open" | "closed" | "all";

interface ChangedFile {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface PullRequest {
  id: number;
  number: number;
  title: string;
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  body: string;
  html_url: string;
  state: string;
  draft?: boolean;
  merged?: boolean;
  labels?: Array<{
    name: string;
    color?: string;
  }>;
  base?: {
    ref: string;
  };
  head?: {
    ref: string;
    sha?: string;
    repo?: {
      full_name?: string;
    } | null;
  };
}

interface GithubCommit {
  sha: string;
  html_url: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
}

interface GithubReview {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string;
  state: string;
  submitted_at: string;
  html_url: string;
}

interface GithubTimelineEvent {
  id?: number;
  event: string;
  created_at: string;
  updated_at?: string;
  actor?: {
    login: string;
    avatar_url: string;
    html_url?: string;
  };
  user?: {
    login: string;
    avatar_url: string;
    html_url?: string;
  };
  body?: string | null;
  html_url?: string;
  state?: string;
  commit_id?: string | null;
  rename?: {
    from: string;
    to: string;
  };
  label?: {
    name: string;
    color?: string;
  };
  dismissed_review?: {
    state?: string;
    review_id?: number;
    dismissal_message?: string | null;
    dismissal_commit_id?: string | null;
  };
  source?: {
    type?: string;
    issue?: {
      html_url?: string;
      number?: number;
      title?: string;
      repository?: {
        full_name?: string;
      };
    };
  };
  changes?: {
    title?: {
      from?: string;
    };
    body?: {
      from?: string;
    };
    base?: {
      ref?: {
        from?: string;
      };
    };
  };
}

interface GithubContentEdit {
  editedAt: string;
  deletedAt?: string | null;
  diff?: string | null;
  editor?: {
    login: string;
    avatarUrl: string;
  } | null;
}

type TimelineEvent =
  | { type: 'commit'; date: string; data: GithubCommit }
  | { type: 'issue_comment'; date: string; data: GithubComment }
  | { type: 'review_comment'; date: string; data: GithubComment }
  | { type: 'timeline'; date: string; data: GithubTimelineEvent }
  | { type: 'content_edit'; date: string; data: GithubContentEdit };

interface Branch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

interface RepoInfo {
  default_branch: string;
  html_url: string;
}

interface RepoTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree" | string;
  sha: string;
  size?: number;
  url: string;
}

interface SearchResult {
  scope: "diff" | "repo";
  path: string;
  detail: string;
  file?: ChangedFile;
  repoItem?: RepoTreeItem;
}

interface DiffRow {
  kind: "meta" | "hunk" | "context" | "added" | "deleted";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

interface DiffE2EState {
  authUserId: string | null;
  authEmail: string | null;
  authLoading: boolean;
  authError: string | null;
  preferencesLoading: boolean;
  preferencesSetupHint: string | null;
  theme: ThemePreference;
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
  isStreamFocus: boolean;
  showUpdates: boolean;
  authMenuOpen: boolean;
  githubWriteEnabled: boolean;
}

interface DiffE2EBridge {
  getState: () => DiffE2EState;
  getSessionSeed: () => { access_token: string; refresh_token: string };
  getSessionSnapshot: () => Session;
  setSession: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  setTheme: (theme: ThemePreference) => void;
  setDefaultRepo: (owner: string, repo: string) => void;
  switchRepo: (owner: string, repo: string) => void;
  reloadPulls: () => Promise<void>;
  selectPull: (number: number) => void;
  toggleSaveSelectedPull: () => void;
  openUpdates: () => void;
  closeUpdates: () => void;
  openAuthMenu: () => void;
  closeAuthMenu: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  setStreamFocus: (enabled: boolean) => void;
  submitDiscussionComment: (body: string) => Promise<void>;
  submitInlineReviewComment: (
    body: string,
    line?: number,
    startLine?: number | null,
  ) => Promise<void>;
  submitReviewAction: (
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
    body?: string,
  ) => Promise<void>;
  getSelectedPullBranchActions: () => {
    canWorkInCode: boolean;
    hasReviewDraftTarget: boolean;
    reviewDraftPath: string | null;
    headRepo: string | null;
    headRef: string | null;
  };
  openSelectedPullBranchInCode: () => Promise<{ branch: string; path: string | null }>;
  draftFirstReviewFix: () => Promise<{ path: string; branch: string }>;
  getCodeFile: (path: string) => Promise<{ path: string; content: string; sha: string }>;
  commitCodeFile: (
    path: string,
    content: string,
    message: string,
  ) => Promise<{ path: string; sha?: string }>;
  createCodeFile: (
    path: string,
    content: string,
    message: string,
  ) => Promise<{ path: string; sha?: string }>;
  writeSessionFile: () => Promise<{ ok: boolean; path: string }>;
}

declare global {
  interface Window {
    __DIFF_E2E__?: DiffE2EBridge;
  }
}

const SYSTEM_OWNER = "coccinella-labs";
const SYSTEM_REPO = "harper";
const LOCAL_STORAGE_DEFAULT_REPO_KEY = "diff_default_repo";
const LOCAL_STORAGE_THEME_KEY = "diff_theme";
const LOCAL_STORAGE_GITHUB_PROVIDER_TOKEN_KEY = "diff_github_provider_token";
const LOCAL_STORAGE_POLICY_ACKNOWLEDGED_KEY = "diff_policy_acknowledged";
const DIFF_LOGO_URL = diffLogoUrl;
const SYSTEM_DEFAULT_REPO = { owner: SYSTEM_OWNER, repo: SYSTEM_REPO };
const readStoredDefaultRepo = () => {
  const saved = localStorage.getItem(LOCAL_STORAGE_DEFAULT_REPO_KEY);
  if (!saved) return SYSTEM_DEFAULT_REPO;

  try {
    return JSON.parse(saved) as { owner: string; repo: string };
  } catch {
    return SYSTEM_DEFAULT_REPO;
  }
};
const readStoredTheme = (): ThemePreference => {
  return (
    (localStorage.getItem(LOCAL_STORAGE_THEME_KEY) as ThemePreference) || "dark"
  );
};
const readStoredGitHubProviderToken = (userId: string) => {
  const saved = localStorage.getItem(LOCAL_STORAGE_GITHUB_PROVIDER_TOKEN_KEY);
  if (!saved) return null;

  try {
    const parsed = JSON.parse(saved) as {
      user_id?: unknown;
      token?: unknown;
    };
    if (parsed.user_id === userId && typeof parsed.token === "string") {
      return parsed.token;
    }
  } catch {
    // Ignore legacy token-only storage; it is not tied to a signed-in user.
  }

  return null;
};
const storeGitHubProviderToken = (userId: string, token: string) => {
  localStorage.setItem(
    LOCAL_STORAGE_GITHUB_PROVIDER_TOKEN_KEY,
    JSON.stringify({ user_id: userId, token }),
  );
};
const readStoredPolicyAcknowledgement = () => {
  return localStorage.getItem(LOCAL_STORAGE_POLICY_ACKNOWLEDGED_KEY) === "true";
};

const preventMouseFocusOnClickControls = (event: ReactMouseEvent<HTMLElement>) => {
  if (event.button !== 0) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return;

  if (target.closest("button, a")) {
    event.preventDefault();
  }
};
const orderPullsForStream = (items: PullRequest[]) => {
  return [...items].sort((a, b) => b.number - a.number);
};
const moveBranchToFront = (items: Branch[], branchName: string | null) => {
  if (!branchName) return items;
  const pinnedBranch = items.find((branch) => branch.name === branchName);
  if (!pinnedBranch) return items;
  return [pinnedBranch, ...items.filter((branch) => branch.name !== branchName)];
};
const clearAuthHashFromUrl = () => {
  if (!window.location.hash && !window.location.href.endsWith("#")) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
};
const MAX_RECENT_REPOS = 6;
const MAX_SAVED_PULLS = 25;
const MAX_VISIBLE_REPO_FILES = 500;
const ALERT_TYPES = {
  NOTE: "border-sky-500/20 bg-sky-500/[0.06] text-sky-300",
  TIP: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
  IMPORTANT: "border-violet-500/20 bg-violet-500/[0.06] text-violet-300",
  WARNING: "border-amber-500/20 bg-amber-500/[0.06] text-amber-300",
  CAUTION: "border-rose-500/20 bg-rose-500/[0.06] text-rose-300",
} as const;
const ALERT_MARKER_PATTERN =
  /^[\s"'`{“”‘’]*(?:\\?\[?!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]?|\\?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])[\]}:.\s-]*/i;

const formatReviewCommentLine = (comment: GithubComment) => {
  const endLine = comment.line ?? comment.original_line;
  const startLine = comment.start_line ?? comment.original_start_line;
  const side = comment.side ?? comment.start_side;
  const isOriginal = comment.line == null && comment.original_line != null;
  const sideLabel = side === "LEFT" ? " old" : "";
  const originalLabel = isOriginal && side !== "LEFT" ? " original" : "";

  if (startLine && endLine && startLine !== endLine) {
    return `lines ${startLine}-${endLine}${sideLabel}${originalLabel}`;
  }

  if (endLine) {
    return `line ${endLine}${sideLabel}${originalLabel}`;
  }

  if (comment.position) {
    return `diff position ${comment.position}`;
  }

  return "file comment";
};

const getTextContent = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getTextContent).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children);
  }

  return "";
};

const normalizeAlertMarkdown = (node: ReactNode) =>
  getTextContent(node).replace(ALERT_MARKER_PATTERN, "").trim();

function Tooltip({
  content,
  children,
  wrapperClassName,
  side = "bottom",
}: {
  content: string;
  children: ReactNode;
  wrapperClassName?: string;
  side?: "bottom" | "right";
}) {
  const tooltipClassName =
    side === "right"
      ? "left-full top-1/2 ml-3 -translate-y-1/2 translate-x-1 scale-[0.98] group-hover/tooltip:translate-x-0 group-hover/tooltip:scale-100"
      : "left-1/2 top-full mt-2 -translate-x-1/2 translate-y-1 scale-[0.98] group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100";

  return (
    <span className={cn("group/tooltip relative inline-flex", wrapperClassName)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-[80] max-w-[min(16rem,calc(100vw-2rem))] whitespace-normal rounded-[18px] border border-white/12 bg-panel px-4 py-2 text-[11px] font-medium normal-case leading-relaxed tracking-[0.01em] text-white/85 shadow-[0_10px_24px_rgba(0,0,0,0.18)] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/tooltip:opacity-100",
          tooltipClassName,
        )}
      >
        {content}
      </span>
    </span>
  );
}

const parseDiffRows = (patch?: string): DiffRow[] => {
  if (!patch) return [];

  const rows: DiffRow[] = [];
  let oldLine: number | null = null;
  let newLine: number | null = null;

  for (const line of patch.split("\n")) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      rows.push({
        kind: "hunk",
        content: line,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      rows.push({
        kind: "meta",
        content: line,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    if (line.startsWith("+")) {
      rows.push({
        kind: "added",
        content: line,
        oldLine: null,
        newLine,
      });
      if (newLine != null) {
        newLine += 1;
      }
      continue;
    }

    if (line.startsWith("-")) {
      rows.push({
        kind: "deleted",
        content: line,
        oldLine,
        newLine: null,
      });
      if (oldLine != null) {
        oldLine += 1;
      }
      continue;
    }

    if (line.startsWith("\\")) {
      rows.push({
        kind: "meta",
        content: line,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    rows.push({
      kind: "context",
      content: line,
      oldLine,
      newLine,
    });
    if (oldLine != null) {
      oldLine += 1;
    }
    if (newLine != null) {
      newLine += 1;
    }
  }

  return rows;
};

const SOFT_LINK_BREAK_CHARS = new Set(["/", ".", "-"]);

const renderTextWithSoftBreaks = (text: string) =>
  text.split(/([/.-])/g).map((part, index) =>
    SOFT_LINK_BREAK_CHARS.has(part) ? (
      <span key={`${part}-${index}`}>
        {part}
        <wbr />
      </span>
    ) : (
      part
    ),
  );

const getGithubIssueLinkLabel = (href?: string, label?: string) => {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [owner, repo, type, number] = parts;
    if (type !== "issues" && type !== "pulls" && type !== "pull") return null;
    if (!/^\d+$/.test(number)) return null;

    const normalizedHref = url.toString().replace(/\/$/, "");
    const normalizedLabel = (label ?? "").trim().replace(/\/$/, "");
    const shouldShorten =
      !normalizedLabel ||
      normalizedLabel === normalizedHref ||
      normalizedLabel === href.replace(/\/$/, "");

    return shouldShorten ? `${owner}/${repo}#${number}` : null;
  } catch {
    return null;
  }
};

const markdownComponents = {
  a({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
    const label = getTextContent(children).trim();
    const githubIssueLabel = getGithubIssueLinkLabel(props.href, label);
    return (
      <a {...props}>
        {githubIssueLabel ??
          Children.map(children, (child) =>
            typeof child === "string" ? renderTextWithSoftBreaks(child) : child,
          )}
      </a>
    );
  },
  blockquote({ children }: { children?: ReactNode }) {
    const firstText = Children.toArray(children)
      .map((child) => getTextContent(child).trimStart())
      .find((text) => text.length > 0) ?? "";
    const match = firstText.match(ALERT_MARKER_PATTERN);

    if (!match) {
      return (
        <blockquote className="border-l border-white/20 pl-4 italic text-white/60">
          {children}
        </blockquote>
      );
    }

    const alertType = (match[1] ?? match[2]).toUpperCase() as keyof typeof ALERT_TYPES;
    return (
      <div className={cn("my-4 border-l-2 px-4 py-3", ALERT_TYPES[alertType])}>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em]">
          {alertType}
        </div>
        <div className="text-white/75">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeSanitize]}
            components={markdownComponents}
          >
            {normalizeAlertMarkdown(children)}
          </ReactMarkdown>
        </div>
      </div>
    );
  },
};

interface CheckRunStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at?: string;
  completed_at?: string | null;
}

interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  description?: string;
  type?: "check_run" | "status";
  started_at?: string;
  completed_at?: string | null;
  output?: {
    title: string | null;
    summary: string | null;
    text: string | null;
  };
  check_suite?: {
    head_branch: string;
    id: number;
  };
  steps?: CheckRunStep[];
  annotations?: any[];
  suite_runs?: CheckRun[];
}

interface CheckSummary {
  mergeable?: boolean | null;
  merge_state_status?: string | null;
}

interface DiffHighlightTarget {
  path: string;
  startLine: number;
  endLine: number;
}

const getFileIcon = (path: string) => {
  if (!path) return <FileCode className="w-2.5 h-2.5 text-white/20" />;
  const normalizedPath = path.toLowerCase();
  const fileName = normalizedPath.split('/').pop() ?? "";
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? "" : "";

  const iconClass = "w-2.5 h-2.5";

  const packageFiles = new Set([
    "cargo.toml",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "composer.json",
    "composer.lock",
    "gemfile",
    "gemfile.lock",
    "podfile",
    "podfile.lock",
    "mix.exs",
    "mix.lock",
    "pubspec.yaml",
    "pubspec.lock",
  ]);

  if (packageFiles.has(fileName)) {
    return <Package className={`${iconClass} text-brand-orange/40`} />;
  }

  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
    return <Package className={`${iconClass} text-sky-400/40`} />;
  }

  if (fileName === ".gitignore" || fileName === ".gitattributes" || fileName === ".editorconfig") {
    return <Settings className={`${iconClass} text-white/20`} />;
  }

  if (fileName.includes("license")) {
    return <Shield className={`${iconClass} text-white/20`} />;
  }

  if (fileName.startsWith("readme") || fileName.startsWith("changelog") || fileName.startsWith("contributing")) {
    return <FileText className={`${iconClass} text-white/20`} />;
  }

  if (fileName.endsWith(".lock")) {
    return <Lock className={`${iconClass} text-white/20`} />;
  }

  if (
    [
      "rs", "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx", "m", "mm",
      "swift", "kt", "kts", "java", "scala", "clj", "cljs", "ex", "exs",
      "erl", "hrl", "zig", "nim", "lua", "rb", "php", "py", "r", "jl",
      "go", "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte", "astro"
    ].includes(ext)
  ) {
    const color =
      ext === "py" ? "text-sky-400/40" :
      ext === "go" ? "text-blue-400/40" :
      ["js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte", "astro"].includes(ext) ? "text-amber-400/40" :
      ext === "rs" ? "text-brand-orange/40" :
      "text-white/25";
    return <FileCode className={`${iconClass} ${color}`} />;
  }

  if (["sh", "bash", "zsh", "fish", "ps1"].includes(ext)) {
    return <Terminal className={`${iconClass} text-sky-400/40`} />;
  }

  if (["sql", "psql", "mysql", "sqlite", "prisma"].includes(ext)) {
    return <Database className={`${iconClass} text-cyan-400/40`} />;
  }

  if (["json", "jsonc", "json5", "yml", "yaml", "toml", "ini", "conf", "cfg"].includes(ext)) {
    return <FileJson className={`${iconClass} text-white/20`} />;
  }

  if (["html", "htm"].includes(ext)) {
    return <Layout className={`${iconClass} text-emerald-400/40`} />;
  }

  if (["css", "scss", "sass", "less", "pcss"].includes(ext)) {
    return <Palette className={`${iconClass} text-pink-400/40`} />;
  }

  if (["md", "mdx", "txt", "rst", "adoc", "doc", "docx", "pdf"].includes(ext)) {
    return <FileText className={`${iconClass} text-white/20`} />;
  }

  if (["csv", "tsv", "xls", "xlsx"].includes(ext)) {
    return <Sheet className={`${iconClass} text-emerald-400/40`} />;
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"].includes(ext)) {
    return <FileImage className={`${iconClass} text-violet-400/40`} />;
  }

  if (["mp4", "mov", "webm", "avi", "mkv", "mp3", "wav", "ogg", "flac"].includes(ext)) {
    return <Activity className={`${iconClass} text-violet-400/30`} />;
  }

  if (["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar"].includes(ext)) {
    return <FileArchive className={`${iconClass} text-amber-400/35`} />;
  }

  if (["wasm", "bin", "so", "dll", "dylib", "exe", "o", "a", "class"].includes(ext)) {
    return <Binary className={`${iconClass} text-white/20`} />;
  }

  if (["pem", "crt", "cer", "key", "csr"].includes(ext)) {
    return <Shield className={`${iconClass} text-white/20`} />;
  }

  if (["graphql", "gql"].includes(ext)) {
    return <Globe className={`${iconClass} text-pink-400/40`} />;
  }

  return <FileCode className={`${iconClass} text-white/20`} />;
};

const getFileKindLabel = (path: string) => {
  const normalizedPath = path.toLowerCase();
  const fileName = normalizedPath.split("/").pop() ?? "";
  const ext = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";

  const packageFiles = new Set([
    "cargo.toml",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "composer.json",
    "composer.lock",
    "gemfile",
    "gemfile.lock",
    "podfile",
    "podfile.lock",
    "mix.exs",
    "mix.lock",
    "pubspec.yaml",
    "pubspec.lock",
  ]);

  if (packageFiles.has(fileName)) return "package";
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) return "docker";
  if (fileName === ".gitignore" || fileName === ".gitattributes" || fileName === ".editorconfig") return "config";
  if (fileName.includes("license")) return "license";
  if (fileName.startsWith("readme") || fileName.startsWith("changelog") || fileName.startsWith("contributing")) return "docs";
  if (fileName.endsWith(".lock")) return "lock";
  if (ext === "rs") return "rust";
  if (ext === "py") return "python";
  if (ext === "go") return "go";
  if (["js", "mjs", "cjs"].includes(ext)) return "javascript";
  if (["ts", "tsx"].includes(ext)) return "typescript";
  if (ext === "jsx") return "react";
  if (ext === "vue") return "vue";
  if (ext === "svelte") return "svelte";
  if (ext === "astro") return "astro";
  if (["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"].includes(ext)) return "c++";
  if (ext === "java") return "java";
  if (["kt", "kts"].includes(ext)) return "kotlin";
  if (ext === "swift") return "swift";
  if (ext === "rb") return "ruby";
  if (ext === "php") return "php";
  if (["sh", "bash", "zsh", "fish", "ps1"].includes(ext)) return "shell";
  if (["sql", "psql", "mysql", "sqlite", "prisma"].includes(ext)) return "data";
  if (["json", "jsonc", "json5", "yml", "yaml", "toml", "ini", "conf", "cfg"].includes(ext)) return "config";
  if (["html", "htm"].includes(ext)) return "html";
  if (["css", "scss", "sass", "less", "pcss"].includes(ext)) return "styles";
  if (["md", "mdx", "txt", "rst", "adoc", "doc", "docx", "pdf"].includes(ext)) return "docs";
  if (["csv", "tsv", "xls", "xlsx"].includes(ext)) return "sheet";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "avi", "mkv", "mp3", "wav", "ogg", "flac"].includes(ext)) return "media";
  if (["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar"].includes(ext)) return "archive";
  if (["wasm", "bin", "so", "dll", "dylib", "exe", "o", "a", "class"].includes(ext)) return "binary";
  if (["pem", "crt", "cer", "key", "csr"].includes(ext)) return "security";
  if (["graphql", "gql"].includes(ext)) return "graphql";
  return ext || "file";
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getPrismLanguage = (path: string) => {
  const normalizedPath = path.toLowerCase();
  const fileName = normalizedPath.split("/").pop() ?? "";
  const ext = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";

  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) return "docker";
  if (fileName === ".env" || fileName.endsWith(".env")) return "ini";
  if (["html", "htm", "xml", "svg"].includes(ext)) return "markup";
  if (["css", "scss", "sass", "less", "pcss"].includes(ext)) return "css";
  if (["js", "mjs", "cjs"].includes(ext)) return "javascript";
  if (ext === "jsx") return "jsx";
  if (ext === "ts") return "typescript";
  if (ext === "tsx") return "tsx";
  if (["json", "jsonc", "json5"].includes(ext)) return "json";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  if (fileName === "cargo.lock") return "toml";
  if (ext === "toml") return "toml";
  if (["ini", "conf", "cfg"].includes(ext)) return "ini";
  if (["sh", "bash", "zsh", "fish"].includes(ext)) return "bash";
  if (ext === "py") return "python";
  if (ext === "rb") return "ruby";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  if (["c", "h"].includes(ext)) return "c";
  if (["cc", "cpp", "cxx", "hh", "hpp", "hxx"].includes(ext)) return "cpp";
  if (ext === "cs") return "csharp";
  if (ext === "java") return "java";
  if (["sql", "psql", "mysql", "sqlite"].includes(ext)) return "sql";
  if (["md", "mdx"].includes(ext)) return "markdown";
  if (["graphql", "gql"].includes(ext)) return "graphql";

  if (
    [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
      "eslint.config.js",
      "tailwind.config.js",
    ].includes(fileName)
  ) {
    return fileName.endsWith(".json") ? "json" : "javascript";
  }

  return null;
};

const highlightCode = (code: string, path: string) => {
  const language = getPrismLanguage(path);
  const grammar = language ? Prism.languages[language] : null;
  if (!language || !grammar) return escapeHtml(code);
  return Prism.highlight(code, grammar, language);
};

const isInvalidRepoFilePath = (filePath: string) =>
  filePath.startsWith("/") ||
  filePath.endsWith("/") ||
  filePath.includes("//") ||
  filePath.split("/").some((segment) => segment === "..");

export default function App() {
  const [viewMode, setViewMode] = useState<"pulls" | "branches" | "code">("pulls");
  const [defaultRepo, setDefaultRepo] = useState(readStoredDefaultRepo);
  const [currentOwner, setCurrentOwner] = useState(defaultRepo.owner);
  const [currentRepo, setCurrentRepo] = useState(defaultRepo.repo);
  const [showRepoInput, setShowRepoInput] = useState(false);
  const [inputRepo, setInputRepo] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [repoTree, setRepoTree] = useState<RepoTreeItem[]>([]);
  const [repoTreeTruncated, setRepoTreeTruncated] = useState(false);
  const [selectedRepoFile, setSelectedRepoFile] = useState<RepoTreeItem | null>(null);
  const [repoFileContent, setRepoFileContent] = useState<string | null>(null);
  const [repoFileDraft, setRepoFileDraft] = useState("");
  const [repoNewFilePath, setRepoNewFilePath] = useState("");
  const [isCreatingRepoFile, setIsCreatingRepoFile] = useState(false);
  const [isEditingRepoFile, setIsEditingRepoFile] = useState(false);
  const [repoCommitMessage, setRepoCommitMessage] = useState("");
  const [repoTargetBranch, setRepoTargetBranch] = useState("");
  const [repoNewBranchName, setRepoNewBranchName] = useState("");
  const [repoPullTitle, setRepoPullTitle] = useState("");
  const [repoPullBody, setRepoPullBody] = useState("");
  const [repoPullUrl, setRepoPullUrl] = useState<string | null>(null);
  const [aiDraftSummary, setAiDraftSummary] = useState<string | null>(null);
  const [prExplanation, setPrExplanation] = useState<string | null>(null);
  const [explainingPr, setExplainingPr] = useState(false);
  const [explainPrError, setExplainPrError] = useState<string | null>(null);
  const [creatingRepoBranch, setCreatingRepoBranch] = useState(false);
  const [creatingRepoPull, setCreatingRepoPull] = useState(false);
  const [committingRepoFile, setCommittingRepoFile] = useState(false);
  const [draftingReviewFix, setDraftingReviewFix] = useState<number | null>(null);
  const [loadingRepoTree, setLoadingRepoTree] = useState(false);
  const [loadingRepoFile, setLoadingRepoFile] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [selectedPull, setSelectedPull] = useState<PullRequest | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);
  const [comments, setComments] = useState<GithubComment[]>([]);
  const [reviewComments, setReviewComments] = useState<GithubComment[]>([]);
  const [commits, setCommits] = useState<GithubCommit[]>([]);
  const [reviews, setReviews] = useState<GithubReview[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<GithubTimelineEvent[]>([]);
  const [contentEdits, setContentEdits] = useState<GithubContentEdit[]>([]);
  const [checkRuns, setCheckRuns] = useState<CheckRun[]>([]);
  const [checkSummary, setCheckSummary] = useState<CheckSummary | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<CheckRun | null>(null);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);
  const [errorRunDetail, setErrorRunDetail] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<string | null>(null);
  const [runLogsFetchedForId, setRunLogsFetchedForId] = useState<number | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [checkDetailTab, setCheckDetailTab] = useState<"steps" | "logs">("steps");
  const lastSelectedRunIdRef = useRef<number | null>(null);
  const [liveLastUpdate, setLiveLastUpdate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"diff" | "discussion" | "checks" | "timeline">("diff");
  const [loading, setLoading] = useState(true);
  const [showUpdates, setShowUpdates] = useState(false);
  const [showPolicyAcknowledgement, setShowPolicyAcknowledgement] = useState(false);
  const [hasAcknowledgedPolicy, setHasAcknowledgedPolicy] = useState(
    readStoredPolicyAcknowledgement,
  );
  const [hasNewUpdates, setHasNewUpdates] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [highlightedDiffTarget, setHighlightedDiffTarget] = useState<DiffHighlightTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isStreamFocus, setIsStreamFocus] = useState(false);
  const [stateFilter, setStateFilter] = useState<PullStateFilter>(
    "open",
  );
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [githubProviderToken, setGitHubProviderToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMenuOpen, setAuthMenuOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [preferencesSetupHint, setPreferencesSetupHint] = useState<string | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesSyncing, setPreferencesSyncing] = useState(false);
  const [isSidebarAccountOpen, setIsSidebarAccountOpen] = useState(false);
  const [isSidebarRecentReposOpen, setIsSidebarRecentReposOpen] = useState(false);
  const [isSidebarSavedPullsOpen, setIsSidebarSavedPullsOpen] = useState(false);
  const [recentRepos, setRecentRepos] = useState<RecentRepoPreference[]>([]);
  const [savedPulls, setSavedPulls] = useState<SavedPullPreference[]>([]);
  const [aiDrafts, setAiDrafts] = useState<AiDraftPreference[]>([]);
  const [activeAiDraftId, setActiveAiDraftId] = useState<string | null>(null);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [newReviewCommentBody, setNewReviewCommentBody] = useState("");
  const [reviewCommentLine, setReviewCommentLine] = useState("");
  const [reviewCommentStartLine, setReviewCommentStartLine] = useState("");
  const [submittingReviewComment, setSubmittingReviewComment] = useState(false);
  const [newReviewBody, setNewReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState<"COMMENT" | "APPROVE" | "REQUEST_CHANGES" | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [isEditingPullMeta, setIsEditingPullMeta] = useState(false);
  const [pullTitleDraft, setPullTitleDraft] = useState("");
  const [pullBodyDraft, setPullBodyDraft] = useState("");
  const [pullLabelsDraft, setPullLabelsDraft] = useState("");
  const [savingPullMeta, setSavingPullMeta] = useState(false);
  const [pullActionInFlight, setPullActionInFlight] = useState<"update" | "merge" | "squash" | "rebase" | null>(null);
  const [deletingHeadBranch, setDeletingHeadBranch] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaChallenge] = useState(() => {
    const a = Math.floor(Math.random() * 4) + 2;
    const b = Math.floor(Math.random() * 4) + 1;
    return { a, b, sum: a + b };
  });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const repoKeyRef = useRef(`${currentOwner}/${currentRepo}`);
  const viewModeRef = useRef(viewMode);
  const stateFilterRef = useRef(stateFilter);
  const selectedPullNumberRef = useRef<number | null>(null);
  const selectedFileNameRef = useRef<string | null>(null);
  const selectedRepoFilePathRef = useRef<string | null>(null);
  const diffHighlightTimeoutRef = useRef<number | null>(null);
  const authMenuRef = useRef<HTMLDivElement | null>(null);
  const preferencesHydratedRef = useRef(false);
  const suspendedCorePreferenceValueRef = useRef<string | null>(null);
  const suspendedRecentReposValueRef = useRef<string | null>(null);
  const suspendedSavedPullsValueRef = useRef<string | null>(null);
  const suspendedAiDraftsValueRef = useRef<string | null>(null);
  const preferenceSyncTimerRef = useRef<number | null>(null);
  const pendingPreferenceSyncRef = useRef<{
    userId: string;
    payload: {
      theme?: ThemePreference;
      default_repo_owner?: string;
      default_repo_name?: string;
      recent_repos?: RecentRepoPreference[];
      saved_pulls?: SavedPullPreference[];
      ai_drafts?: AiDraftPreference[];
    };
  } | null>(null);
  const pullCacheRef = useRef<Record<PullStateFilter, PullRequest[]>>({
    open: [],
    closed: [],
    all: [],
  });
  const pullCacheLoadedRef = useRef<Partial<Record<PullStateFilter, boolean>>>({});
  const pullHasMoreCacheRef = useRef<Record<PullStateFilter, boolean>>({
    open: false,
    closed: false,
    all: false,
  });
  const preferenceSyncChainRef = useRef(Promise.resolve());
  const preferenceSyncSequenceRef = useRef(0);
  const preferenceSyncPendingCountRef = useRef(0);
  const authUserIdRef = useRef<string | null>(null);
  const pendingSavedPullRef = useRef<SavedPullPreference | null>(null);
  const pendingSavedPullLoadRef = useRef<string | null>(null);
  const deferredRepoSearchQuery = useDeferredValue(repoSearchQuery);
  const canReadRemoteRepo = true;
  const readAuthKey = `${authLoading ? "loading" : "ready"}:${authSession?.access_token ? "session" : "public"}:${githubProviderToken ? "github" : "none"}`;

  useEffect(() => {
    viewModeRef.current = viewMode;
    stateFilterRef.current = stateFilter;
  }, [viewMode, stateFilter]);

  useEffect(() => {
    selectedFileNameRef.current = selectedFile?.filename ?? null;
  }, [selectedFile?.filename]);

  useEffect(() => {
    selectedRepoFilePathRef.current = selectedRepoFile?.path ?? null;
  }, [selectedRepoFile?.path]);

  const diffRows = useMemo(() => parseDiffRows(selectedFile?.patch), [selectedFile?.patch]);
  const repoFiles = useMemo(() => repoTree.filter((item) => item.type === "blob"), [repoTree]);
  const normalizedRepoSearchQuery = deferredRepoSearchQuery.trim().toLowerCase();
  const repoSearchResults: SearchResult[] = useMemo(() => {
    if (!normalizedRepoSearchQuery) return [];

    const diffMatches = files
      .filter((file) => {
        const haystack = `${file.filename}\n${file.patch ?? ""}`.toLowerCase();
        return haystack.includes(normalizedRepoSearchQuery);
      })
      .slice(0, 12)
      .map((file) => ({
        scope: "diff" as const,
        path: file.filename,
        detail: file.patch?.toLowerCase().includes(normalizedRepoSearchQuery)
          ? "Diff content match"
          : "Changed file path",
        file,
      }));

    const repoMatches = repoFiles
      .filter((item) => item.path.toLowerCase().includes(normalizedRepoSearchQuery))
      .slice(0, 24)
      .map((item) => ({
        scope: "repo" as const,
        path: item.path,
        detail: item.size != null ? `${item.size.toLocaleString()} bytes` : "Repository file",
        repoItem: item,
      }));

    return [...diffMatches, ...repoMatches];
  }, [files, normalizedRepoSearchQuery, repoFiles]);
  const visibleRepoFiles = useMemo(
    () =>
      normalizedRepoSearchQuery
        ? repoSearchResults
            .filter((result) => result.scope === "repo" && result.repoItem)
            .map((result) => result.repoItem!)
        : repoFiles.slice(0, MAX_VISIBLE_REPO_FILES),
    [normalizedRepoSearchQuery, repoFiles, repoSearchResults],
  );
  const repoFilesCountLabel =
    visibleRepoFiles.length === repoFiles.length
      ? repoFiles.length.toLocaleString()
      : `${visibleRepoFiles.length.toLocaleString()} / ${repoFiles.length.toLocaleString()}`;
  const highlightedRepoFileContent = useMemo(() => {
    const filePath = isCreatingRepoFile ? repoNewFilePath : selectedRepoFile?.path;
    if (repoFileContent == null || !filePath) return null;
    return highlightCode(repoFileContent, filePath);
  }, [isCreatingRepoFile, repoFileContent, repoNewFilePath, selectedRepoFile?.path]);
  const releasedUpdates = APP_UPDATES.filter((update) => update.category !== "planned");
  const plannedUpdates = APP_UPDATES.filter((update) => update.category === "planned");
  const checkStats = checkRuns.reduce(
    (acc, run) => {
      if (run.status !== "completed") acc.pending++;
      else if (run.conclusion === "success") acc.success++;
      else if (
        run.conclusion === "failure" ||
        run.conclusion === "timed_out" ||
        run.conclusion === "action_required" ||
        run.conclusion === "startup_failure" ||
        run.conclusion === "stale"
      ) acc.failure++;
      else if (run.conclusion === "cancelled") acc.cancelled++;
      else if (run.conclusion === "skipped") acc.skipped++;
      else acc.other++;
      return acc;
    },
    { success: 0, failure: 0, pending: 0, cancelled: 0, skipped: 0, other: 0 },
  );
  const authDisplayName =
    authUser?.user_metadata?.user_name ||
    authUser?.user_metadata?.preferred_username ||
    authUser?.email?.split("@")[0] ||
    authUser?.email ||
    "Account";
  const authAvatarUrl =
    authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture;
  const authProvider =
    typeof authSession?.user.app_metadata?.provider === "string"
      ? authSession.user.app_metadata.provider
      : "github";
  const selectedPullIsSaved = selectedPull
    ? savedPulls.some(
        (pull) =>
          pull.owner === currentOwner &&
          pull.repo === currentRepo &&
          pull.pull_number === selectedPull.number,
      )
    : false;
  const selectedPullLabels = selectedPull?.labels ?? [];
  const eligibleDraftFixComments = reviewComments.filter((comment) => Boolean(comment.path));
  const makeAiDraftId = (
    owner: string,
    repo: string,
    pullNumber: number,
    commentId: number,
    path: string,
    branch: string,
  ) => `${owner}/${repo}#${pullNumber}:${commentId}:${branch}:${path}`;
  const findSavedAiDraft = (comment: GithubComment) => {
    const headRef = selectedPull?.head?.ref;
    const filePath = comment.path?.trim();
    if (!selectedPull || !headRef || !filePath) return null;
    const draftId = makeAiDraftId(
      currentOwner,
      currentRepo,
      selectedPull.number,
      comment.id,
      filePath,
      headRef,
    );
    return aiDrafts.find((draft) => draft.id === draftId) ?? null;
  };
  const parsedPullLabelsDraft = pullLabelsDraft
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const activeRepoRef = repoTargetBranch.trim() || repoInfo?.default_branch || "HEAD";
  const activeRepoFilePath = isCreatingRepoFile ? repoNewFilePath.trim() : selectedRepoFile?.path ?? "";
  const isPullBranchWorkspace = viewMode === "code" && Boolean(selectedPull && repoTargetBranch.trim());
  const isRepoBufferLoading = loadingRepoTree || loadingRepoFile;
  const canDeletePullHeadBranch =
    selectedPull?.state === "closed" &&
    selectedPull?.merged &&
    selectedPull.head?.repo?.full_name === `${currentOwner}/${currentRepo}` &&
    !!selectedPull.head?.ref;
  const canWorkPullBranchInCode =
    selectedPull?.head?.repo?.full_name === `${currentOwner}/${currentRepo}` &&
    !!selectedPull.head?.ref;
  const canResolvePullConflictsInCode = canWorkPullBranchInCode;
  const canCommitRepoFile =
    isEditingRepoFile &&
    !!activeRepoFilePath &&
    !!repoCommitMessage.trim() &&
    (isCreatingRepoFile || repoFileDraft !== repoFileContent);
  const availableReviewLines = Array.from(
    new Set(
      diffRows
        .filter(
          (row) =>
            row.newLine != null &&
            row.kind !== "deleted" &&
            row.kind !== "meta" &&
            row.kind !== "hunk",
        )
        .map((row) => row.newLine as number),
    ),
  ).sort((a, b) => a - b);

  const navigateToComment = (path: string, line: number, startLine?: number) => {
    setActiveTab("diff");
    const file = files.find(f => f.filename === path);
    if (file) {
      setSelectedFile(file);
      // Wait for React to render the diff before scrolling
      setTimeout(() => {
        const rangeStart = startLine ?? line;
        const rangeEnd = line;
        const id = `line-${path}-${rangeStart}`;
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightedDiffTarget({
            path,
            startLine: Math.min(rangeStart, rangeEnd),
            endLine: Math.max(rangeStart, rangeEnd),
          });
          if (diffHighlightTimeoutRef.current) {
            window.clearTimeout(diffHighlightTimeoutRef.current);
          }
          diffHighlightTimeoutRef.current = window.setTimeout(() => {
            setHighlightedDiffTarget((current) => {
              if (
                current &&
                current.path === path &&
                current.startLine === Math.min(rangeStart, rangeEnd) &&
                current.endLine === Math.max(rangeStart, rangeEnd)
              ) {
                return null;
              }
              return current;
            });
            diffHighlightTimeoutRef.current = null;
          }, 4000);
        }
      }, 500);
    }
  };

  const reviewById = new Map(reviews.map((review) => [review.id, review]));

  const trackRecentRepo = (owner: string, repo: string) => {
    setRecentRepos((current) => {
      const next: RecentRepoPreference[] = [
        {
          owner,
          repo,
          last_viewed_at: new Date().toISOString(),
        },
        ...current.filter(
          (entry) => !(entry.owner === owner && entry.repo === repo),
        ),
      ];

      return next.slice(0, MAX_RECENT_REPOS);
    });
  };

  const clearRecentRepos = () => {
    setRecentRepos([]);
    setIsSidebarRecentReposOpen(false);
  };

  const toggleSavedPull = () => {
    if (!selectedPull) return;

    setSavedPulls((current) => {
      const exists = current.some(
        (pull) =>
          pull.owner === currentOwner &&
          pull.repo === currentRepo &&
          pull.pull_number === selectedPull.number,
      );

      if (exists) {
        return current.filter(
          (pull) =>
            !(
              pull.owner === currentOwner &&
              pull.repo === currentRepo &&
              pull.pull_number === selectedPull.number
            ),
        );
      }

      return [
        {
          owner: currentOwner,
          repo: currentRepo,
          pull_number: selectedPull.number,
          title: selectedPull.title,
          html_url: selectedPull.html_url,
          state: selectedPull.state,
          draft: Boolean(selectedPull.draft),
          saved_at: new Date().toISOString(),
        },
        ...current,
      ].slice(0, MAX_SAVED_PULLS);
    });
  };

  const openSavedPull = (savedPull: SavedPullPreference) => {
    pendingSavedPullRef.current = savedPull;
    setViewMode("pulls");
    setStateFilter(savedPull.state === "closed" ? "closed" : "open");
    setIsSidebarOpen(false);

    if (savedPull.owner !== currentOwner || savedPull.repo !== currentRepo) {
      switchRepo(savedPull.owner, savedPull.repo);
      return;
    }

    const existingPull = pulls.find((pull) => pull.number === savedPull.pull_number);
    if (existingPull) {
      handleSelectPull(existingPull);
      pendingSavedPullRef.current = null;
    } else {
      fetchPulls(1, true);
    }
  };

  const signInWithGitHub = async () => {
    if (!supabase) return;
    setAuthError(null);
    setAuthMenuOpen(false);
    setShowPolicyAcknowledgement(false);
    setAuthLoading(true);
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo,
        scopes: "repo read:user user:email",
      },
    });

    if (signInError) {
      setAuthError(signInError.message);
      setAuthLoading(false);
    }
  };

  const beginGitHubSignIn = () => {
    if (!isSupabaseConfigured || authLoading) return;
    if (!hasAcknowledgedPolicy) {
      setAuthError(null);
      setAuthMenuOpen(false);
      setShowPolicyAcknowledgement(true);
      return;
    }
    signInWithGitHub();
  };

  const acknowledgePolicyAndSignIn = () => {
    localStorage.setItem(LOCAL_STORAGE_POLICY_ACKNOWLEDGED_KEY, "true");
    setHasAcknowledgedPolicy(true);
    signInWithGitHub();
  };

  const signOut = async () => {
    if (!supabase) return;
    setAuthError(null);
    setAuthMenuOpen(false);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setAuthError(signOutError.message);
    }
  };

  const getWriteHeaders = () => {
    if (!authSession?.access_token) {
      throw new Error("Supabase session is missing. Sign in again.");
    }

    if (!githubProviderToken) {
      throw new Error("GitHub write token is missing. Refresh sign-in.");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSession.access_token}`,
      "X-GitHub-Provider-Token": githubProviderToken,
    };
  };

  const getReadHeaders = () => {
    if (!authSession?.access_token || !githubProviderToken) {
      return undefined;
    }

    return {
      Authorization: `Bearer ${authSession.access_token}`,
      "X-GitHub-Provider-Token": githubProviderToken,
    };
  };

  const refreshReviewData = async (pullNumber: number) => {
    const readHeaders = getReadHeaders();
    const [commentsRes, reviewCommentsRes, reviewsRes, timelineRes] = await Promise.all([
      fetch(`/api/pulls/${pullNumber}/comments?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
      fetch(`/api/pulls/${pullNumber}/review-comments?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
      fetch(`/api/pulls/${pullNumber}/reviews?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
      fetch(`/api/pulls/${pullNumber}/timeline?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
    ]);

    if (commentsRes.ok) setComments(await commentsRes.json());
    if (reviewCommentsRes.ok) setReviewComments(await reviewCommentsRes.json());
    if (reviewsRes.ok) setReviews(await reviewsRes.json());
    if (timelineRes.ok) setTimelineEvents(await timelineRes.json());
  };

  const submitComment = async (bodyOverride?: string) => {
    if (!selectedPull) return;

    const body = (bodyOverride ?? newCommentBody).trim();
    if (!body) {
      setWriteError("Comment body is required.");
      return;
    }

    setSubmittingComment(true);
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/comments?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "POST",
          headers: getWriteHeaders(),
          body: JSON.stringify({ body }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to publish comment.");
      }

      setComments((current) => [...current, data]);
      setAuthError(null);
      if (!bodyOverride) {
        setNewCommentBody("");
      }
      return data;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to publish comment.";
      setWriteError(message);
      throw new Error(message);
    } finally {
      setSubmittingComment(false);
    }
  };

  const submitInlineReviewComment = async (
    bodyOverride?: string,
    lineOverride?: number,
    startLineOverride?: number | null,
    fileOverride?: ChangedFile,
  ) => {
    if (!selectedPull || !selectedFile) return;

    const targetFile = fileOverride ?? selectedFile;
    const targetReviewLines = parseDiffRows(targetFile.patch)
      .filter(
        (row) =>
          row.newLine != null &&
          row.kind !== "deleted" &&
          row.kind !== "meta" &&
          row.kind !== "hunk",
      )
      .map((row) => row.newLine as number);
    const body = (bodyOverride ?? newReviewCommentBody).trim();
    const line = Number(lineOverride ?? reviewCommentLine);
    const startLineValue =
      startLineOverride !== undefined
        ? startLineOverride
        : reviewCommentStartLine.trim().length > 0
        ? Number(reviewCommentStartLine)
        : null;

    if (!body) {
      setWriteError("Review comment body is required.");
      return;
    }

    if (!selectedPull.head?.sha) {
      setWriteError("Head commit SHA is missing for this pull request.");
      return;
    }

    if (!Number.isFinite(line) || line <= 0) {
      setWriteError("Choose a valid target line.");
      return;
    }

    if (!targetReviewLines.includes(line)) {
      setWriteError("Target line is not present in the current diff.");
      return;
    }

    if (
      startLineValue != null &&
      (!Number.isFinite(startLineValue) ||
        startLineValue <= 0 ||
        !targetReviewLines.includes(startLineValue))
    ) {
      setWriteError("Start line is not present in the current diff.");
      return;
    }

    setSubmittingReviewComment(true);
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/review-comments?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "POST",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            body,
            path: targetFile.filename,
            commit_id: selectedPull.head.sha,
            line,
            side: "RIGHT",
            start_line:
              startLineValue != null && startLineValue !== line
                ? startLineValue
                : undefined,
            start_side:
              startLineValue != null && startLineValue !== line
                ? "RIGHT"
                : undefined,
          }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to publish review comment.");
      }

      setReviewComments((current) => [...current, data]);
      setAuthError(null);
      if (!bodyOverride) {
        setNewReviewCommentBody("");
        setReviewCommentStartLine("");
      }
      await refreshReviewData(selectedPull.number);
      return data;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to publish review comment.";
      setWriteError(message);
      throw new Error(message);
    } finally {
      setSubmittingReviewComment(false);
    }
  };

  const submitReview = async (
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
    bodyOverride?: string,
  ) => {
    if (!selectedPull) return;

    const body = (bodyOverride ?? newReviewBody).trim();

    if (event === "REQUEST_CHANGES" && !body) {
      setWriteError("Add review guidance before requesting changes.");
      return;
    }

    setSubmittingReview(event);
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/reviews?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "POST",
          headers: getWriteHeaders(),
          body: JSON.stringify({ body, event }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to submit review.");
      }

      setReviews((current) => [...current, data]);
      setAuthError(null);
      if (body && bodyOverride == null) {
        setNewReviewBody("");
      }
      await refreshReviewData(selectedPull.number);
      return data;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit review.";
      setWriteError(message);
      throw new Error(message);
    } finally {
      setSubmittingReview(null);
    }
  };

  const savePullMetadata = async () => {
    if (!selectedPull) return;
    const title = pullTitleDraft.trim();

    if (!title) {
      setWriteError("Pull request title is required.");
      return;
    }

    setSavingPullMeta(true);
    setWriteError(null);

    try {
      const [pullResponse, labelsResponse] = await Promise.all([
        fetch(`/api/pulls/${selectedPull.number}?owner=${currentOwner}&repo=${currentRepo}`, {
          method: "PATCH",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            title,
            body: pullBodyDraft,
          }),
        }),
        fetch(`/api/pulls/${selectedPull.number}/labels?owner=${currentOwner}&repo=${currentRepo}`, {
          method: "PUT",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            labels: parsedPullLabelsDraft,
          }),
        }),
      ]);

      const pullData = await pullResponse.json().catch(() => ({}));
      if (!pullResponse.ok) {
        throw new Error(pullData.error || `Pull update failed with ${pullResponse.status}`);
      }

      const labelsData = await labelsResponse.json().catch(() => ([]));
      if (!labelsResponse.ok) {
        throw new Error(labelsData.error || `Label update failed with ${labelsResponse.status}`);
      }

      const nextPull = {
        ...pullData,
        labels: Array.isArray(labelsData) ? labelsData : pullData.labels,
      } as PullRequest;
      selectedPullNumberRef.current = nextPull.number;
      setSelectedPull(nextPull);
      setPulls((current) =>
        orderPullsForStream(current.map((pull) => (pull.number === nextPull.number ? nextPull : pull))),
      );
      setIsEditingPullMeta(false);
      await refreshReviewData(selectedPull.number);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Failed to update pull request.");
    } finally {
      setSavingPullMeta(false);
    }
  };

  const runPullUpdateBranch = async () => {
    if (!selectedPull) return;

    setPullActionInFlight("update");
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/update-branch?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "POST",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            expected_head_sha: selectedPull.head?.sha,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Branch update failed with ${response.status}`);
      }

      setActiveTab("checks");
      await refreshSelectedPullSnapshot(selectedPull.number);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Failed to update branch.");
    } finally {
      setPullActionInFlight(null);
    }
  };

  const runPullMerge = async (method: "merge" | "squash" | "rebase") => {
    if (!selectedPull) return;

    setPullActionInFlight(method);
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/merge?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "PUT",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            method,
            title: selectedPull.title,
            sha: selectedPull.head?.sha,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Pull request ${method} failed with ${response.status}`);
      }

      await refreshSelectedPullSnapshot(selectedPull.number);
      await fetchPulls(1, true);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : `Failed to ${method} pull request.`);
    } finally {
      setPullActionInFlight(null);
    }
  };

  const getPreferredPullFilePath = async () => {
    const localPath = selectedFile?.filename ?? files[0]?.filename;
    if (localPath) return localPath;
    if (!selectedPull?.number) return "";

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/files?owner=${currentOwner}&repo=${currentRepo}`,
        { headers: getReadHeaders() },
      );
      if (!response.ok) return "";
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return "";
      setFiles(data);
      setSelectedFile(data[0]);
      return typeof data[0]?.filename === "string" ? data[0].filename : "";
    } catch {
      return "";
    }
  };

  const workPullBranchInCode = async () => {
    const headRef = selectedPull?.head?.ref;
    if (!headRef || !canWorkPullBranchInCode) {
      setWriteError("Code edits are only available for branches in this repository.");
      return null;
    }

    const preferredPath = await getPreferredPullFilePath();
    setWriteError(null);
    setAiDraftSummary(null);
    setActiveAiDraftId(null);
    setRepoTargetBranch(headRef);
    setRepoNewBranchName("");
    setRepoPullTitle(selectedPull?.title || "");
    setRepoPullBody(selectedPull?.body || "");
    setRepoPullUrl(selectedPull?.html_url ?? null);
    setRepoSearchQuery("");
    setViewMode("code");
    setActiveTab("diff");
    await fetchRepoTree(headRef, {
      preservePull: true,
      preferredPath,
    });
    return { branch: headRef, path: preferredPath || null };
  };

  const openAiDraft = async (draft: AiDraftPreference) => {
    setWriteError(null);
    setLoadingRepoFile(true);
    try {
      setRepoTargetBranch(draft.branch);
      setRepoNewBranchName("");
      setRepoPullTitle((current) => current || draft.pull_title || `Update ${draft.path}`);
      setRepoPullBody((current) => current || "Updated from DIFF Code view.");
      setRepoPullUrl(selectedPull?.html_url ?? null);
      setRepoSearchQuery(draft.path);
      setSelectedRepoFile(null);
      setRepoFileContent(null);
      setRepoFileDraft("");
      setIsCreatingRepoFile(false);
      setIsEditingRepoFile(false);
      setViewMode("code");
      setActiveTab("diff");
      await fetchRepoTree(draft.branch, { preservePull: true, preferredPath: draft.path });
      const fileSha = await getRepoFileSha(draft.path, draft.branch).catch(() => "");
      const contentResponse = await fetch(
        `/api/repo/content?owner=${draft.owner}&repo=${draft.repo}&path=${encodeURIComponent(draft.path)}&ref=${encodeURIComponent(draft.branch)}`,
        { headers: getReadHeaders() },
      );
      if (!contentResponse.ok) {
        const errorData = await contentResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `File load failed with ${contentResponse.status}`);
      }
      const currentContent = await contentResponse.text();
      setSelectedRepoFile({
        path: draft.path,
        mode: "100644",
        type: "blob",
        sha: fileSha,
        size: new Blob([currentContent]).size,
        url: "",
      });
      if (currentContent !== draft.original_content) {
        setRepoFileContent(currentContent);
        setRepoFileDraft(currentContent);
        setRepoCommitMessage(`Update ${draft.path}`);
        setIsCreatingRepoFile(false);
        setIsEditingRepoFile(false);
        setActiveAiDraftId(null);
        setAiDraftSummary(null);
        setWriteError("Saved draft is stale because this branch file changed. Draft again from the review comment.");
        return;
      }
      setRepoFileContent(draft.original_content);
      setRepoFileDraft(draft.draft_content);
      setRepoCommitMessage(`Address review for ${draft.path}`);
      setIsCreatingRepoFile(false);
      setIsEditingRepoFile(true);
      setAiDraftSummary(draft.summary || "Saved draft restored.");
      setActiveAiDraftId(draft.id);
    } finally {
      setLoadingRepoFile(false);
    }
  };

  const deleteAiDraft = (draftId = activeAiDraftId) => {
    if (!draftId) return;
    setAiDrafts((current) => current.filter((draft) => draft.id !== draftId));
    if (activeAiDraftId === draftId) {
      setActiveAiDraftId(null);
      setAiDraftSummary(null);
    }
  };

  const explainPrWithAlma = async () => {
    const diff = files
      .filter((file) => file.patch)
      .map((file) => `diff --git a/${file.filename} b/${file.filename}\n${file.patch}`)
      .join("\n\n");

    if (!diff) {
      setExplainPrError("No diff is available to explain.");
      return;
    }

    setExplainingPr(true);
    setExplainPrError(null);
    setPrExplanation(null);

    try {
      const response = await fetch("/api/ai/explain-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff, question: "Explain this pull request." }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Alma review failed with ${response.status}`);
      }
      if (typeof data.review !== "string" || !data.review) {
        throw new Error("Alma returned an empty review.");
      }
      setPrExplanation(data.review);
    } catch (error) {
      setExplainPrError(
        error instanceof Error ? error.message : "Failed to explain this pull request.",
      );
    } finally {
      setExplainingPr(false);
    }
  };

  const draftReviewFixWithGemini = async (comment: GithubComment) => {
    const headRef = selectedPull?.head?.ref;
    const filePath = comment.path?.trim() ?? "";

    if (!headRef || !canWorkPullBranchInCode) {
      setWriteError("AI drafts are only available for branches in this repository.");
      return;
    }

    if (!filePath) {
      setWriteError("Review comment file path is unavailable.");
      return;
    }

    const savedDraft = findSavedAiDraft(comment);
    if (savedDraft) {
      try {
        await openAiDraft(savedDraft);
      } catch (error) {
        setWriteError(error instanceof Error ? error.message : "Failed to open saved draft.");
      }
      return;
    }

    setDraftingReviewFix(comment.id);
    setWriteError(null);
    setAiDraftSummary(null);
    setActiveAiDraftId(null);

    try {
      const draftResponse = await fetch("/api/ai/review-fix", {
        method: "POST",
        headers: getWriteHeaders(),
        body: JSON.stringify({
          owner: currentOwner,
          repo: currentRepo,
          pullNumber: selectedPull.number,
          commentId: comment.id,
          path: filePath,
          ref: headRef,
        }),
      });
      const draftData = await draftResponse.json().catch(() => ({}));
      if (!draftResponse.ok) {
        throw new Error(draftData.error || `Gemini draft failed with ${draftResponse.status}`);
      }

      if (typeof draftData.content !== "string") {
        throw new Error("Gemini did not return file content.");
      }
      const draftContent = draftData.content;
      if (typeof draftData.originalContent !== "string") {
        throw new Error("Gemini did not return the verified file baseline.");
      }
      const verifiedOriginalContent = draftData.originalContent;
      const summary =
        typeof draftData.summary === "string"
          ? draftData.summary
          : "Gemini drafted a minimal fix.";
      const draftId = makeAiDraftId(
        currentOwner,
        currentRepo,
        selectedPull.number,
        comment.id,
        filePath,
        headRef,
      );
      const savedDraft: AiDraftPreference = {
        id: draftId,
        owner: currentOwner,
        repo: currentRepo,
        pull_number: selectedPull.number,
        pull_title: selectedPull.title,
        branch: headRef,
        path: filePath,
        comment_id: comment.id,
        comment_body: comment.body,
        original_content: verifiedOriginalContent,
        draft_content: draftContent,
        summary,
        updated_at: new Date().toISOString(),
      };

      const fileSha = await getRepoFileSha(filePath, headRef).catch(() => "");
      const nextFile: RepoTreeItem = {
        path: filePath,
        mode: "100644",
        type: "blob",
        sha: fileSha,
        size: new Blob([verifiedOriginalContent]).size,
        url: "",
      };

      setLoadingRepoFile(true);
      setRepoTargetBranch(headRef);
      setRepoNewBranchName("");
      setRepoPullTitle((current) => current || selectedPull?.title || `Update ${filePath}`);
      setRepoPullBody((current) => current || selectedPull?.body || "Updated from DIFF Code view.");
      setRepoPullUrl(selectedPull?.html_url ?? null);
      setRepoSearchQuery(filePath);
      setSelectedRepoFile(null);
      setRepoFileContent(null);
      setRepoFileDraft("");
      setIsCreatingRepoFile(false);
      setIsEditingRepoFile(false);
      setViewMode("code");
      setActiveTab("diff");
      await fetchRepoTree(headRef, { preservePull: true, preferredPath: filePath });
      setSelectedRepoFile(nextFile);
      setRepoFileContent(verifiedOriginalContent);
      setRepoFileDraft(draftContent);
      setRepoCommitMessage(`Address review for ${filePath}`);
      setIsCreatingRepoFile(false);
      setIsEditingRepoFile(true);
      setActiveAiDraftId(draftId);
      setAiDraftSummary(summary);
      setAiDrafts((current) => [
        savedDraft,
        ...current.filter((draft) => draft.id !== draftId),
      ].slice(0, 25));
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Failed to draft review fix.");
    } finally {
      setDraftingReviewFix(null);
      setLoadingRepoFile(false);
    }
  };

  const resolvePullConflictsInCode = async () => {
    const headRef = selectedPull?.head?.ref;
    if (!headRef || !canResolvePullConflictsInCode) {
      setWriteError("Conflict resolution in Code view is only available for branches in this repository.");
      return;
    }

    setWriteError(null);
    const preferredPath = await getPreferredPullFilePath();
    setRepoTargetBranch(headRef);
    setRepoNewBranchName("");
    setRepoPullUrl(selectedPull?.html_url ?? null);
    setViewMode("code");
    setActiveTab("diff");
    await fetchRepoTree(headRef, {
      preservePull: true,
      preferredPath,
    });
  };

  const deletePullHeadBranch = async () => {
    if (!selectedPull) return;

    setDeletingHeadBranch(true);
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}/head-branch?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "DELETE",
          headers: getWriteHeaders(),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Branch delete failed with ${response.status}`);
      }

      await refreshSelectedPullSnapshot(selectedPull.number);
      await fetchPulls(1, true);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Failed to delete branch.");
    } finally {
      setDeletingHeadBranch(false);
    }
  };

  const getTimeline = (): TimelineEvent[] => {
    if (!selectedPull && !selectedBranch) return [];

    const events: TimelineEvent[] = [];

    commits.forEach(c => events.push({ type: 'commit', date: c.commit.author.date, data: c }));
    if (selectedBranch) {
      return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    comments.forEach(c => events.push({ type: 'issue_comment', date: c.created_at, data: c }));
    reviewComments.forEach(c => events.push({ type: 'review_comment', date: c.created_at, data: c }));
    contentEdits.forEach((edit) => {
      if (edit.editedAt) {
        events.push({ type: "content_edit", date: edit.editedAt, data: edit });
      }
    });
    timelineEvents
      .filter((event) => event.created_at)
      .filter((event) => {
        if (event.event === "commented") return false;
        if (event.event === "committed") return false;
        if (event.event === "reviewed" && event.state?.toUpperCase() === "COMMENTED" && !event.body?.trim()) {
          return false;
        }
        return true;
      })
      .forEach((event) => events.push({ type: 'timeline', date: event.created_at, data: event }));

    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const getTimelineMeta = (event: TimelineEvent) => {
    if (event.type === "commit") {
      return { label: "Commit", labelClass: "text-sky-500/40", dotClass: "border-sky-500/40", icon: <GitCommit className="w-2 h-2 text-sky-500" /> };
    }
    if (event.type === "issue_comment") {
      return { label: "Comment", labelClass: "text-white/20", dotClass: "border-white/10", icon: <MessageSquare className="w-2 h-2 text-white/30" /> };
    }
    if (event.type === "review_comment") {
      return { label: "Review Comment", labelClass: "text-white/20", dotClass: "border-white/10", icon: <MessageCircle className="w-2 h-2 text-white/30" /> };
    }
    if (event.type === "content_edit") {
      return { label: "Description updated", labelClass: "text-white/20", dotClass: "border-white/10", icon: <FileText className="w-2 h-2 text-white/30" /> };
    }

    const timelineEvent = event.data;
    switch (timelineEvent.event) {
      case "reviewed": {
        const state = timelineEvent.state?.toUpperCase() ?? "COMMENTED";
        if (state === "APPROVED") {
          return { label: "Review: approved", labelClass: "text-emerald-500/40", dotClass: "border-emerald-500/40", icon: <CheckCircle className="w-2.5 h-2.5 text-emerald-500" /> };
        }
        if (state === "CHANGES_REQUESTED") {
          return { label: "Review: changes requested", labelClass: "text-rose-500/40", dotClass: "border-rose-500/40", icon: <AlertCircle className="w-2.5 h-2.5 text-rose-500" /> };
        }
        if (state === "DISMISSED") {
          return { label: "Review: dismissed", labelClass: "text-white/20", dotClass: "border-white/10", icon: <CheckCircle className="w-2.5 h-2.5 text-white/30" /> };
        }
        return { label: "Review: commented", labelClass: "text-white/20", dotClass: "border-white/10", icon: <MessageCircle className="w-2 h-2 text-white/30" /> };
      }
      case "review_dismissed":
        return { label: "Review dismissed", labelClass: "text-rose-500/40", dotClass: "border-rose-500/40", icon: <XCircle className="w-2.5 h-2.5 text-rose-500" /> };
      case "renamed":
        return { label: "Title changed", labelClass: "text-white/20", dotClass: "border-white/10", icon: <History className="w-2 h-2 text-white/30" /> };
      case "edited":
        return { label: "Details updated", labelClass: "text-white/20", dotClass: "border-white/10", icon: <FileText className="w-2 h-2 text-white/30" /> };
      case "labeled":
      case "unlabeled":
        return { label: timelineEvent.event === "labeled" ? "Label added" : "Label removed", labelClass: "text-white/20", dotClass: "border-white/10", icon: <Hash className="w-2 h-2 text-white/30" /> };
      case "head_ref_force_pushed":
        return { label: "Force pushed", labelClass: "text-white/20", dotClass: "border-white/10", icon: <ArrowRight className="w-2 h-2 text-white/30" /> };
      case "added_to_project_v2":
      case "project_v2_item_status_changed":
        return { label: "Project updated", labelClass: "text-white/20", dotClass: "border-white/10", icon: <Box className="w-2 h-2 text-white/30" /> };
      case "convert_to_draft":
        return { label: "Converted to draft", labelClass: "text-white/20", dotClass: "border-white/10", icon: <CircleSlash className="w-2 h-2 text-white/30" /> };
      case "ready_for_review":
        return { label: "Ready for review", labelClass: "text-emerald-500/40", dotClass: "border-emerald-500/40", icon: <CheckCircle className="w-2.5 h-2.5 text-emerald-500" /> };
      case "cross-referenced":
        return { label: "Linked issue", labelClass: "text-white/20", dotClass: "border-white/10", icon: <ExternalLink className="w-2 h-2 text-white/30" /> };
      default:
        return { label: timelineEvent.event.replace(/_/g, " "), labelClass: "text-white/20", dotClass: "border-white/10", icon: <Circle className="w-2 h-2 text-white/20" /> };
    }
  };

  const renderTimelineEventBody = (event: TimelineEvent) => {
    if (event.type === "commit") {
      return (
        <div className="space-y-4 border-l border-white/5 pl-6">
          <div className="flex items-center gap-4">
            {event.data.author?.avatar_url ? (
              <img src={event.data.author.avatar_url} className="w-4 h-4 rounded-full opacity-20 shrink-0" />
            ) : (
              <GitCommit className="w-4 h-4 text-white/20 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-normal text-white/40 line-clamp-2 leading-relaxed">{event.data.commit.message} <span className="text-[8px] text-white/10 font-mono ml-2">{event.data.sha.substring(0, 7)}</span></p>
            </div>
          </div>
        </div>
      );
    }

    if (event.type === "issue_comment" || event.type === "review_comment") {
      const isReviewComment = event.type === "review_comment";
      return (
        <div className="space-y-4 border-l border-white/5 pl-6">
          <div className="flex items-center gap-4">
            <img src={event.data.user.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
            <p className="text-sm font-medium text-white/80">
              {event.data.user.login}
              <span className="text-[9px] uppercase tracking-widest text-white/20 ml-2">
                {isReviewComment ? "Review" : "Comment"}
              </span>
            </p>
          </div>
          <div className="markdown-body prose prose-invert prose-xs max-w-none text-white/30">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSanitize]}
              components={markdownComponents}
            >
              {event.data.body}
            </ReactMarkdown>
          </div>
          {isReviewComment && event.data.path && (
            <button
              onClick={() => {
                const line = event.data.line || event.data.original_line;
                const startLine = event.data.start_line || event.data.original_start_line;
                if (event.data.path && line) {
                  navigateToComment(event.data.path, line, startLine);
                }
              }}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 opacity-50 transition-opacity group/anchor hover:opacity-100"
            >
              <div className="flex min-w-0 flex-[1_1_100%] items-start gap-2 text-left sm:flex-1 sm:items-center">
                {getFileIcon(event.data.path)}
                <span className="min-w-0 break-all text-[8px] font-mono leading-relaxed sm:truncate">
                  {event.data.path}
                </span>
                <span className="hidden shrink-0 rounded-sm border border-white/[0.04] bg-white/[0.015] px-1 py-px text-[6px] font-medium uppercase tracking-[0.16em] text-white/14 sm:inline">
                  {getFileKindLabel(event.data.path)}
                </span>
              </div>
              <span className="pl-5 text-[8px] font-mono leading-none sm:pl-0">
                {formatReviewCommentLine(event.data)}
              </span>
              <span className="inline-flex items-center gap-1 text-[7px] font-medium uppercase tracking-[0.18em] leading-none text-white/18 transition-colors group-hover/anchor:text-brand-orange">
                Open in Diff
                <ArrowRight className="w-2.5 h-2.5 transition-transform duration-300 ease-out group-hover/anchor:translate-x-0.5 group-hover/anchor:scale-[1.04]" />
              </span>
            </button>
          )}
        </div>
      );
    }

    if (event.type === "content_edit") {
      const preview = event.data.diff?.trim();
      const previewLines = preview ? preview.split("\n").slice(0, 6).join("\n") : "";
      return (
        <div className="space-y-4 border-l border-white/5 pl-6">
          <div className="flex items-center gap-4">
            {event.data.editor?.avatarUrl ? (
              <img src={event.data.editor.avatarUrl} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded-full border border-white/10 bg-white/[0.02] shrink-0" />
            )}
            <p className="text-sm font-medium text-white/80">
              {event.data.editor?.login || "github"}
              <span className="text-white/40 font-normal"> updated the pull request description</span>
            </p>
          </div>
          {previewLines ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-4">
              <div className="mb-3 text-[8px] font-medium uppercase tracking-[0.24em] text-white/18">
                Previous version
              </div>
              <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/30 font-mono">
                {previewLines}
                {preview && preview.split("\n").length > 6 ? "\n..." : ""}
              </pre>
            </div>
          ) : (
            <p className="text-[12px] text-white/35 leading-relaxed">
              Description updated.
            </p>
          )}
        </div>
      );
    }

    const timelineEvent = event.data;
    const actor = timelineEvent.actor ?? timelineEvent.user;
    const actorName = actor?.login ?? "github";

    switch (timelineEvent.event) {
      case "reviewed": {
        const reviewState = timelineEvent.state?.toUpperCase() ?? "COMMENTED";
        const stateClass =
          reviewState === "APPROVED" ? "text-emerald-500/40" :
          reviewState === "CHANGES_REQUESTED" ? "text-rose-500/40" :
          "text-white/20";
        const stateLabel =
          reviewState === "DISMISSED" ? "Previously reviewed" : reviewState.replace(/_/g, " ");
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-center gap-4">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white/80">{actorName} <span className={cn("text-[9px] uppercase tracking-widest ml-2", stateClass)}>{stateLabel}</span></p>
              </div>
            </div>
            {reviewState === "DISMISSED" ? (
              <p className="text-[13px] font-normal text-white/40 leading-relaxed">
                {actorName} previously approved these changes.
              </p>
            ) : timelineEvent.body?.trim() ? (
              <div className="markdown-body prose prose-invert prose-xs max-w-none text-white/30 text-[11px]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  components={markdownComponents}
                >
                  {timelineEvent.body}
                </ReactMarkdown>
              </div>
            ) : null}
          </div>
        );
      }
      case "review_dismissed": {
        const dismissedReview = timelineEvent.dismissed_review?.review_id
          ? reviewById.get(timelineEvent.dismissed_review.review_id)
          : undefined;
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-center gap-4">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white/80">
                  {actorName}
                  <span className="text-white/40 font-normal"> dismissed </span>
                  <span className="text-white/80">{dismissedReview?.user.login || "a reviewer"}</span>
                  <span className="text-white/40 font-normal">'s {timelineEvent.dismissed_review?.state || "review"}</span>
                  {timelineEvent.dismissed_review?.dismissal_commit_id && (
                    <span className="text-[8px] text-white/10 font-mono ml-2">{timelineEvent.dismissed_review.dismissal_commit_id.substring(0, 7)}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        );
      }
      case "renamed":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-center gap-4">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/80">{actorName} <span className="text-white/40 font-normal">changed the title</span></p>
                <p className="text-[12px] text-white/30 leading-relaxed break-words">
                  <span className="text-white/20 line-through">{timelineEvent.rename?.from}</span>
                  <span className="mx-2 text-white/10">{"->"}</span>
                  <span className="text-white/60">{timelineEvent.rename?.to}</span>
                </p>
              </div>
            </div>
          </div>
        );
      case "edited": {
        const changedFields = [
          timelineEvent.changes?.body ? "description" : null,
          timelineEvent.changes?.title ? "title" : null,
          timelineEvent.changes?.base?.ref ? "base branch" : null,
        ].filter(Boolean) as string[];
        const summary =
          changedFields.length > 0
            ? changedFields.join(", ")
            : "pull request details";
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-center gap-4">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="text-sm font-medium text-white/80">
                {actorName}
                <span className="text-white/40 font-normal"> updated the {summary}</span>
              </p>
            </div>
            {timelineEvent.changes?.title?.from && (
              <div className="text-[12px] text-white/35 leading-relaxed">
                <span className="text-white/20">Title:</span>{" "}
                <span className="text-white/20 line-through">{timelineEvent.changes.title.from}</span>
                <span className="text-white/10 mx-2">{"->"}</span>
                <span className="text-white/60">{selectedPull?.title}</span>
              </div>
            )}
            {timelineEvent.changes?.body && (
              <p className="text-[12px] text-white/35 leading-relaxed">
                Description updated.
              </p>
            )}
            {timelineEvent.changes?.base?.ref?.from && selectedPull?.base?.ref && (
              <div className="text-[12px] text-white/35 leading-relaxed">
                <span className="text-white/20">Base:</span>{" "}
                <span className="text-white/20 line-through">{timelineEvent.changes.base.ref.from}</span>
                <span className="text-white/10 mx-2">{"->"}</span>
                <span className="text-white/60">{selectedPull.base.ref}</span>
              </div>
            )}
          </div>
        );
      }
      case "labeled":
      case "unlabeled":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">
                {actorName}
                <span className="text-white/40 font-normal"> {timelineEvent.event === "labeled" ? "added" : "removed"} the </span>
                <span className="inline-flex max-w-full align-middle rounded-full px-2 py-0.5 text-[10px] font-medium text-white/80 border border-white/10 bg-white/[0.04] break-all">{timelineEvent.label?.name}</span>
                <span className="text-white/40 font-normal"> label</span>
              </p>
            </div>
          </div>
        );
      case "head_ref_force_pushed":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">
                {actorName}
                <span className="text-white/40 font-normal"> force-pushed the </span>
                <span className="text-white/70 font-mono break-all">{selectedPull?.head?.ref || "branch"}</span>
                <span className="text-white/40 font-normal"> branch</span>
                {timelineEvent.commit_id && (
                  <span className="text-[8px] text-white/10 font-mono ml-2">{timelineEvent.commit_id.substring(0, 7)}</span>
                )}
              </p>
            </div>
          </div>
        );
      case "added_to_project_v2":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">{actorName} <span className="text-white/40 font-normal">added this to the project</span></p>
            </div>
          </div>
        );
      case "project_v2_item_status_changed":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">{actorName} <span className="text-white/40 font-normal">updated the project status</span></p>
            </div>
          </div>
        );
      case "convert_to_draft":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">{actorName} <span className="text-white/40 font-normal">converted this pull request to draft</span></p>
            </div>
          </div>
        );
      case "ready_for_review":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">{actorName} <span className="text-white/40 font-normal">marked this pull request ready for review</span></p>
            </div>
          </div>
        );
      case "cross-referenced":
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">
                {actorName}
                <span className="text-white/40 font-normal"> referenced this from </span>
                {timelineEvent.source?.issue?.html_url ? (
                  <a href={timelineEvent.source.issue.html_url} target="_blank" rel="noreferrer" className="text-white/70 underline decoration-white/10 underline-offset-4 break-all">
                    {(timelineEvent.source.issue.repository?.full_name || "issue")}#{timelineEvent.source.issue.number}
                  </a>
                ) : (
                  <span className="text-white/70">another issue</span>
                )}
              </p>
            </div>
          </div>
        );
      default:
        return (
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img src={actor?.avatar_url} className="w-6 h-6 rounded-full opacity-40 shrink-0" />
              <p className="min-w-0 text-[13px] sm:text-sm font-medium leading-relaxed text-white/80 break-words">{actorName} <span className="text-white/40 font-normal">{timelineEvent.event.replace(/_/g, " ")}</span></p>
            </div>
          </div>
        );
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let cancelled = false;

    if (selectedRunId) {
      const run = checkRuns.find((r) => r.id === selectedRunId);
      if (!run) {
        setSelectedRunId(null);
        return;
      }

      const isNewRunSelection = lastSelectedRunIdRef.current !== selectedRunId;
      lastSelectedRunIdRef.current = selectedRunId;
      if (isNewRunSelection) {
        setSelectedRunDetail(null);
        setRunLogs(null);
        setRunLogsFetchedForId(null);
        setLoadingLogs(false);
        setLoadingRunDetail(false);
        setErrorRunDetail(null);
      }

      const fetchLogs = async (jobId: number) => {
        setLoadingLogs(true);
        try {
          const response = await fetch(
            `/api/checks/${jobId}/logs?owner=${currentOwner}&repo=${currentRepo}`,
            { headers: getReadHeaders() },
          );
          if (response.ok) {
            const text = await response.text();
            if (!cancelled) setRunLogs(text);
          }
        } catch (error) {
          console.error("Error fetching logs:", error);
        } finally {
          if (!cancelled) {
            setRunLogsFetchedForId(selectedRunId);
            setLoadingLogs(false);
          }
        }
      };

      const fetchRunDetail = async () => {
        setLoadingRunDetail(true);
        setErrorRunDetail(null);
        try {
          const response = await fetch(
            `/api/checks/${selectedRunId}?owner=${currentOwner}&repo=${currentRepo}`,
            { headers: getReadHeaders() },
          );
          if (response.ok) {
            const data = await response.json();
            if (cancelled) return;
            setSelectedRunDetail(data);
            if (typeof data.job_id === "number") {
              await fetchLogs(data.job_id);
            } else {
              setRunLogs(null);
              setRunLogsFetchedForId(selectedRunId);
            }

            // If it's now completed, we should probably stop polling or do one last fetch
            if (data.status === "completed" && interval) {
                clearInterval(interval);
            }
          } else {
            const errData = await response.json();
            if (cancelled) return;
            setErrorRunDetail(errData.error || "Failed to fetch run details from GitHub");
            setSelectedRunDetail(run);
          }
        } catch (error) {
          if (cancelled) return;
          setErrorRunDetail(error instanceof Error ? error.message : "Network error while fetching check details");
          setSelectedRunDetail(run);
        } finally {
          if (!cancelled) setLoadingRunDetail(false);
        }
      };

      if (run.type === "status") {
        setSelectedRunDetail(run);
        setLoadingRunDetail(false);
        setRunLogs(null);
        setRunLogsFetchedForId(run.id);
        setLoadingLogs(false);
      } else {
        fetchRunDetail();

        // Start polling if it's in progress
        if (run.status === "in_progress" || run.status === "queued") {
          interval = setInterval(() => {
            fetchRunDetail();
          }, 5000); // Poll every 5 seconds
        }
      }
    } else {
      lastSelectedRunIdRef.current = null;
      setSelectedRunDetail(null);
      setRunLogs(null);
      setRunLogsFetchedForId(null);
      setLoadingLogs(false);
      setLoadingRunDetail(false);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [selectedRunId, checkRuns, currentOwner, currentRepo]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(LOCAL_STORAGE_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const isSystemDefault =
      defaultRepo.owner === SYSTEM_DEFAULT_REPO.owner &&
      defaultRepo.repo === SYSTEM_DEFAULT_REPO.repo;

    if (isSystemDefault) {
      localStorage.removeItem(LOCAL_STORAGE_DEFAULT_REPO_KEY);
      return;
    }

    localStorage.setItem(
      LOCAL_STORAGE_DEFAULT_REPO_KEY,
      JSON.stringify(defaultRepo),
    );
  }, [defaultRepo]);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setAuthError(sessionError.message);
      } else {
        setAuthError(null);
      }
      const session = data.session;
      setAuthSession(session);
      setAuthUser(session?.user ?? null);
      const providerToken = session
        ? session.provider_token ?? readStoredGitHubProviderToken(session.user.id)
        : null;
      if (session?.provider_token) {
        storeGitHubProviderToken(session.user.id, session.provider_token);
      }
      if (!session) {
        localStorage.removeItem(LOCAL_STORAGE_GITHUB_PROVIDER_TOKEN_KEY);
      }
      setGitHubProviderToken(providerToken);
      if (session) {
        clearAuthHashFromUrl();
      }
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setAuthSession(session);
      setAuthUser(session?.user ?? null);
      setAuthError(null);
      if (session?.provider_token) {
        storeGitHubProviderToken(session.user.id, session.provider_token);
        setGitHubProviderToken(session.provider_token);
        clearAuthHashFromUrl();
      } else if (session) {
        setGitHubProviderToken(readStoredGitHubProviderToken(session.user.id));
      } else if (event === "SIGNED_OUT") {
        localStorage.removeItem(LOCAL_STORAGE_GITHUB_PROVIDER_TOKEN_KEY);
        setGitHubProviderToken(null);
      }
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    authUserIdRef.current = authUser?.id ?? null;
  }, [authUser?.id]);

  const runPreferenceSync = useCallback(
    (
      userId: string,
      syncPayload: {
        theme?: ThemePreference;
        default_repo_owner?: string;
        default_repo_name?: string;
        recent_repos?: RecentRepoPreference[];
        saved_pulls?: SavedPullPreference[];
        ai_drafts?: AiDraftPreference[];
      },
    ) => {
      const syncSequence = preferenceSyncSequenceRef.current + 1;
      preferenceSyncSequenceRef.current = syncSequence;
      preferenceSyncPendingCountRef.current += 1;
      setPreferencesSyncing(true);

      preferenceSyncChainRef.current = preferenceSyncChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const { error: preferencesError } = await upsertUserPreferences(
            userId,
            syncPayload,
          );

          const isCurrentUser = authUserIdRef.current === userId;

          if (preferencesError && isCurrentUser) {
            if (isMissingUserPreferencesTableError(preferencesError)) {
              setPreferencesSetupHint(
                "Run the Supabase preference schema to enable sync.",
              );
            } else {
              setAuthError(preferencesError.message);
            }
          } else if (isCurrentUser) {
            setPreferencesSetupHint(null);
            setAuthError(null);
          }

          preferenceSyncPendingCountRef.current = Math.max(
            0,
            preferenceSyncPendingCountRef.current - 1,
          );

          if (
            isCurrentUser &&
            syncSequence === preferenceSyncSequenceRef.current &&
            preferenceSyncPendingCountRef.current === 0
          ) {
            setPreferencesSyncing(false);
          }
        });
    },
    [],
  );

  const queuePreferenceSync = useCallback(
    (
      userId: string,
      syncPayload: {
        theme?: ThemePreference;
        default_repo_owner?: string;
        default_repo_name?: string;
        recent_repos?: RecentRepoPreference[];
        saved_pulls?: SavedPullPreference[];
        ai_drafts?: AiDraftPreference[];
      },
    ) => {
      const pending = pendingPreferenceSyncRef.current;
      pendingPreferenceSyncRef.current = {
        userId,
        payload: pending?.userId === userId
          ? { ...pending.payload, ...syncPayload }
          : syncPayload,
      };
      setPreferencesSyncing(true);

      if (preferenceSyncTimerRef.current !== null) {
        window.clearTimeout(preferenceSyncTimerRef.current);
      }

      preferenceSyncTimerRef.current = window.setTimeout(() => {
        preferenceSyncTimerRef.current = null;
        const nextSync = pendingPreferenceSyncRef.current;
        pendingPreferenceSyncRef.current = null;
        if (!nextSync) return;
        runPreferenceSync(nextSync.userId, nextSync.payload);
      }, 250);
    },
    [runPreferenceSync],
  );

  useEffect(() => {
    if (!supabase || !authUser) {
      preferencesHydratedRef.current = false;
      suspendedCorePreferenceValueRef.current = null;
      suspendedRecentReposValueRef.current = null;
      suspendedSavedPullsValueRef.current = null;
      suspendedAiDraftsValueRef.current = null;
      if (preferenceSyncTimerRef.current !== null) {
        window.clearTimeout(preferenceSyncTimerRef.current);
        preferenceSyncTimerRef.current = null;
      }
      pendingPreferenceSyncRef.current = null;
      preferenceSyncSequenceRef.current = 0;
      preferenceSyncPendingCountRef.current = 0;
      preferenceSyncChainRef.current = Promise.resolve();
      setPreferencesLoading(false);
      setPreferencesSyncing(false);
      setPreferencesSetupHint(null);
      setRecentRepos([]);
      setSavedPulls([]);
      setAiDrafts([]);
      setActiveAiDraftId(null);
      return;
    }

    let active = true;
    setPreferencesLoading(true);

    fetchUserPreferences(authUser.id).then(({ data, error: preferencesError }) => {
      if (!active) return;

      if (preferencesError) {
        if (isMissingUserPreferencesTableError(preferencesError)) {
          setPreferencesSetupHint("Run the Supabase preference schema to enable sync.");
          preferencesHydratedRef.current = true;
          setPreferencesLoading(false);
          return;
        }
        setAuthError(preferencesError.message);
        preferencesHydratedRef.current = true;
        setPreferencesLoading(false);
        return;
      }

      setPreferencesSetupHint(null);
      setAuthError(null);

      if (data) {
        suspendedCorePreferenceValueRef.current = JSON.stringify({
          theme: data.theme ?? theme,
          default_repo_owner: data.default_repo_owner ?? defaultRepo.owner,
          default_repo_name: data.default_repo_name ?? defaultRepo.repo,
        });
        suspendedRecentReposValueRef.current = JSON.stringify(
          data.recent_repos ?? [],
        );
        suspendedSavedPullsValueRef.current = JSON.stringify(
          data.saved_pulls ?? [],
        );
        suspendedAiDraftsValueRef.current = JSON.stringify(
          data.ai_drafts ?? [],
        );

        if (data.theme && data.theme !== theme) {
          setTheme(data.theme);
        }

        if (data.default_repo_owner && data.default_repo_name) {
          setDefaultRepo({
            owner: data.default_repo_owner,
            repo: data.default_repo_name,
          });
        }

        setRecentRepos(data.recent_repos ?? []);
        setSavedPulls(data.saved_pulls ?? []);
        setAiDrafts(data.ai_drafts ?? []);
      }

      preferencesHydratedRef.current = true;
      setPreferencesLoading(false);
    });

    return () => {
      active = false;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (!supabase || !authUser || !preferencesHydratedRef.current) return;

    const currentCoreValue = JSON.stringify({
      theme,
      default_repo_owner: defaultRepo.owner,
      default_repo_name: defaultRepo.repo,
    });

    if (suspendedCorePreferenceValueRef.current != null) {
      const shouldSkip =
        suspendedCorePreferenceValueRef.current === currentCoreValue;
      suspendedCorePreferenceValueRef.current = null;
      if (shouldSkip) return;
    }

    queuePreferenceSync(authUser.id, {
      theme,
      default_repo_owner: defaultRepo.owner,
      default_repo_name: defaultRepo.repo,
    });
  }, [authUser?.id, defaultRepo, queuePreferenceSync, theme]);

  useEffect(() => {
    if (!supabase || !authUser || !preferencesHydratedRef.current) return;

    const currentRecentReposValue = JSON.stringify(recentRepos);
    if (suspendedRecentReposValueRef.current != null) {
      const shouldSkip =
        suspendedRecentReposValueRef.current === currentRecentReposValue;
      suspendedRecentReposValueRef.current = null;
      if (shouldSkip) return;
    }

    queuePreferenceSync(authUser.id, {
      recent_repos: recentRepos,
    });
  }, [authUser?.id, queuePreferenceSync, recentRepos]);

  useEffect(() => {
    if (!supabase || !authUser || !preferencesHydratedRef.current) return;

    const currentSavedPullsValue = JSON.stringify(savedPulls);
    if (suspendedSavedPullsValueRef.current != null) {
      const shouldSkip =
        suspendedSavedPullsValueRef.current === currentSavedPullsValue;
      suspendedSavedPullsValueRef.current = null;
      if (shouldSkip) return;
    }

    queuePreferenceSync(authUser.id, {
      saved_pulls: savedPulls,
    });
  }, [authUser?.id, queuePreferenceSync, savedPulls]);

  useEffect(() => {
    if (!supabase || !authUser || !preferencesHydratedRef.current) return;

    const currentAiDraftsValue = JSON.stringify(aiDrafts);
    if (suspendedAiDraftsValueRef.current != null) {
      const shouldSkip =
        suspendedAiDraftsValueRef.current === currentAiDraftsValue;
      suspendedAiDraftsValueRef.current = null;
      if (shouldSkip) return;
    }

    queuePreferenceSync(authUser.id, {
      ai_drafts: aiDrafts,
    });
  }, [aiDrafts, authUser?.id, queuePreferenceSync]);

  useEffect(() => {
    if (!authMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (authMenuRef.current?.contains(event.target as Node)) return;
      setAuthMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAuthMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [authMenuOpen]);

  useEffect(() => {
    setIsSidebarAccountOpen(true);
  }, [authUser]);

  useEffect(() => {
    setIsSidebarRecentReposOpen(authUser ? recentRepos.length > 0 : false);
  }, [authUser, recentRepos.length]);

  useEffect(() => {
    setIsSidebarSavedPullsOpen(authUser ? savedPulls.length > 0 : false);
  }, [authUser, savedPulls.length]);

  useEffect(() => {
    repoKeyRef.current = `${currentOwner}/${currentRepo}`;
  }, [currentOwner, currentRepo]);

  useEffect(() => {
    setIsEditingPullMeta(false);
    setPullTitleDraft(selectedPull?.title ?? "");
    setPullBodyDraft(selectedPull?.body ?? "");
    setPullLabelsDraft((selectedPull?.labels ?? []).map((label) => label.name).join(", "));
  }, [selectedPull?.id, selectedPull?.title, selectedPull?.body, selectedPull?.labels]);

  useEffect(() => {
    if (!authUser) return;
    trackRecentRepo(currentOwner, currentRepo);
  }, [authUser?.id, currentOwner, currentRepo]);

  useEffect(() => {
    const pendingSavedPull = pendingSavedPullRef.current;
    if (!pendingSavedPull) return;
    if (viewMode !== "pulls") return;
    if (pendingSavedPull.owner !== currentOwner || pendingSavedPull.repo !== currentRepo) {
      return;
    }

    const matchingPull = pulls.find(
      (pull) => pull.number === pendingSavedPull.pull_number,
    );

    if (matchingPull) {
      pendingSavedPullRef.current = null;
      pendingSavedPullLoadRef.current = null;
      handleSelectPull(matchingPull);
      return;
    }

    const pendingKey = `${pendingSavedPull.owner}/${pendingSavedPull.repo}#${pendingSavedPull.pull_number}`;
    if (pendingSavedPullLoadRef.current === pendingKey) {
      return;
    }

    pendingSavedPullLoadRef.current = pendingKey;

    const loadSavedPull = async () => {
      try {
        const response = await fetch(
          `/api/pulls/${pendingSavedPull.pull_number}?owner=${pendingSavedPull.owner}&repo=${pendingSavedPull.repo}`,
        );
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const message =
            typeof errorData.error === "string"
              ? errorData.error
              : `Server responded with ${response.status}`;
          throw new Error(message);
        }

        if (pendingSavedPullRef.current !== pendingSavedPull) return;
        if (currentOwner !== pendingSavedPull.owner || currentRepo !== pendingSavedPull.repo) return;

        const pull: PullRequest = await response.json();
        pendingSavedPullRef.current = null;
        pendingSavedPullLoadRef.current = null;
        handleSelectPull(pull);
      } catch (err) {
        if (pendingSavedPullRef.current !== pendingSavedPull) return;
        pendingSavedPullLoadRef.current = null;
        setError(err instanceof Error ? err.message : "Failed to open saved pull request.");
      }
    };

    loadSavedPull();
  }, [pulls, viewMode, currentOwner, currentRepo]);

  const resetRepoState = () => {
    setRepoInfo(null);
    setBranches([]);
    setSelectedBranch(null);
    setRepoTree([]);
    setRepoTreeTruncated(false);
    setSelectedRepoFile(null);
    setRepoFileContent(null);
    setRepoFileDraft("");
    setRepoNewFilePath("");
    setIsCreatingRepoFile(false);
    setIsEditingRepoFile(false);
    setRepoCommitMessage("");
    setRepoTargetBranch("");
    setRepoNewBranchName("");
    setRepoPullTitle("");
    setRepoPullBody("");
    setRepoPullUrl(null);
    setRepoSearchQuery("");
    setPulls([]);
    pullCacheRef.current = { open: [], closed: [], all: [] };
    pullCacheLoadedRef.current = {};
    pullHasMoreCacheRef.current = { open: false, closed: false, all: false };
    selectedPullNumberRef.current = null;
    setSelectedPull(null);
    setFiles([]);
    setSelectedFile(null);
    setComments([]);
    setReviewComments([]);
    setCommits([]);
    setReviews([]);
    setTimelineEvents([]);
    setContentEdits([]);
    setCheckRuns([]);
    setCheckSummary(null);
    setActiveTab("diff");
    setPage(1);
    setHasMore(true);
    setLoading(true);
    setLoadingFiles(false);
    setLoadingComments(false);
    setLoadingMore(false);
  };

  const switchRepo = (owner: string, repo: string) => {
    const nextOwner = owner.trim();
    const nextRepo = repo.trim();
    if (!nextOwner || !nextRepo) return;
    if (nextOwner === currentOwner && nextRepo === currentRepo) return;

    repoKeyRef.current = `${nextOwner}/${nextRepo}`;
    resetRepoState();
    trackRecentRepo(nextOwner, nextRepo);
    setCurrentOwner(nextOwner);
    setCurrentRepo(nextRepo);
    setError(null);
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    window.__DIFF_E2E__ = {
      getState: () => ({
        authUserId: authUser?.id ?? null,
        authEmail: authUser?.email ?? null,
        authLoading,
        authError,
        preferencesLoading,
        preferencesSyncing,
        preferencesSetupHint,
        theme,
        currentOwner,
        currentRepo,
        defaultRepo,
        recentReposCount: recentRepos.length,
        savedPullsCount: savedPulls.length,
        selectedPullNumber: selectedPull?.number ?? null,
        selectedFileName: selectedFile?.filename ?? null,
        selectedRepoFilePath: selectedRepoFile?.path ?? null,
        loadedPullNumbers: pulls.map((pull) => pull.number),
        loadedFilesCount: files.length,
        reviewDraftPath: reviewComments.find((comment) => Boolean(comment.path))?.path ?? null,
        repoTargetBranch,
        loading,
        activeTab,
        viewMode,
        isSidebarOpen,
        isStreamFocus,
        showUpdates,
        authMenuOpen,
        githubWriteEnabled: Boolean(githubProviderToken),
      }),
      getSessionSeed: () => {
        if (!authSession?.access_token || !authSession?.refresh_token) {
          throw new Error("No active Supabase session seed is available.");
        }
        return {
          access_token: authSession.access_token,
          refresh_token: authSession.refresh_token,
        };
      },
      getSessionSnapshot: () => {
        if (!authSession) {
          throw new Error("No active Supabase session snapshot is available.");
        }
        return authSession;
      },
      setSession: async (session) => {
        if (!supabase) {
          throw new Error("Supabase is not configured.");
        }
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (sessionError) {
          throw sessionError;
        }
      },
      signOut: async () => {
        if (!supabase) {
          throw new Error("Supabase is not configured.");
        }
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          throw signOutError;
        }
      },
      setTheme: (nextTheme) => setTheme(nextTheme),
      setDefaultRepo: (owner, repo) =>
        setDefaultRepo({ owner: owner.trim(), repo: repo.trim() }),
      switchRepo: (owner, repo) => switchRepo(owner, repo),
      reloadPulls: async () => {
        await fetchPulls(1, true);
      },
      selectPull: (number) => {
        const targetPull = pulls.find((pull) => pull.number === number);
        if (!targetPull) {
          throw new Error(`Pull #${number} is not loaded.`);
        }
        handleSelectPull(targetPull);
      },
      toggleSaveSelectedPull: () => toggleSavedPull(),
      openUpdates: () => setShowUpdates(true),
      closeUpdates: () => setShowUpdates(false),
      openAuthMenu: () => setAuthMenuOpen(true),
      closeAuthMenu: () => setAuthMenuOpen(false),
      openSidebar: () => setIsSidebarOpen(true),
      closeSidebar: () => setIsSidebarOpen(false),
      setStreamFocus: (enabled) => setIsStreamFocus(Boolean(enabled)),
      submitDiscussionComment: async (body) => {
        setWriteError(null);
        setAuthError(null);
        await submitComment(body);
        if (writeError || authError) {
          throw new Error(writeError || authError || "Discussion comment failed.");
        }
      },
      submitInlineReviewComment: async (body, line, startLine) => {
        const targetFile = selectedFile ?? files[0] ?? null;
        if (!targetFile) {
          throw new Error("No selected diff file is available.");
        }
        if (!selectedFile && files[0]) {
          setSelectedFile(files[0]);
        }
        const targetLines = parseDiffRows(targetFile.patch)
          .filter(
            (row) =>
              row.newLine != null &&
              row.kind !== "deleted" &&
              row.kind !== "meta" &&
              row.kind !== "hunk",
          )
          .map((row) => row.newLine as number);
        const rangeLines = [...new Set(targetLines)].sort((a, b) => a - b);
        const adjacentRange = rangeLines
          .slice(1)
          .map((lineValue, index) => ({
            startLine: rangeLines[index],
            line: lineValue,
          }))
          .find((range) => range.line === range.startLine + 1);
        const useAutoRange = startLine === -1;
        const targetLine =
          line ??
          (useAutoRange ? adjacentRange?.line : undefined) ??
          rangeLines[0] ??
          availableReviewLines[0];
        const targetStartLine = useAutoRange ? adjacentRange?.startLine : startLine;
        if (!targetLine) {
          throw new Error("No diff line available for inline review comment.");
        }
        setWriteError(null);
        setAuthError(null);
        await submitInlineReviewComment(body, targetLine, targetStartLine, targetFile);
        if (writeError || authError) {
          throw new Error(writeError || authError || "Inline review comment failed.");
        }
      },
      submitReviewAction: async (event, body) => {
        setWriteError(null);
        setAuthError(null);
        await submitReview(event, body);
        if (writeError || authError) {
          throw new Error(writeError || authError || "Review submission failed.");
        }
      },
      getSelectedPullBranchActions: () => ({
        canWorkInCode: Boolean(canWorkPullBranchInCode),
        hasReviewDraftTarget: reviewComments.some((comment) => Boolean(comment.path)),
        reviewDraftPath: reviewComments.find((comment) => Boolean(comment.path))?.path ?? null,
        headRepo: selectedPull?.head?.repo?.full_name ?? null,
        headRef: selectedPull?.head?.ref ?? null,
      }),
      openSelectedPullBranchInCode: async () => {
        const branch = selectedPull?.head?.ref;
        if (!branch) {
          throw new Error("No selected pull branch is available.");
        }
        if (!canWorkPullBranchInCode) {
          throw new Error("Selected pull branch is outside this repository.");
        }
        const result = await workPullBranchInCode();
        return { branch, path: result?.path ?? null };
      },
      draftFirstReviewFix: async () => {
        const comment = reviewComments.find((item) => Boolean(item.path));
        const branch = selectedPull?.head?.ref;
        if (!comment?.path || !branch) {
          throw new Error("No review comment with a file path is available.");
        }
        if (!canWorkPullBranchInCode) {
          throw new Error("Draft Fix is only available for branches in this repository.");
        }
        await draftReviewFixWithGemini(comment);
        return { path: comment.path, branch };
      },
      getCodeFile: async (filePath) => {
        const branch = activeRepoRef;
        const treeResponse = await fetch(
          `/api/repo/tree?owner=${currentOwner}&repo=${currentRepo}&ref=${encodeURIComponent(branch)}`,
          { headers: getReadHeaders() },
        );
        if (!treeResponse.ok) {
          const errorData = await treeResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to load repository tree.");
        }
        const treeData = await treeResponse.json();
        const item = Array.isArray(treeData.tree)
          ? treeData.tree.find((entry: RepoTreeItem) => entry.path === filePath && entry.type === "blob")
          : null;
        if (!item) {
          throw new Error(`File ${filePath} is not available in the repository tree.`);
        }
        const contentResponse = await fetch(
          `/api/repo/content?owner=${currentOwner}&repo=${currentRepo}&path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(branch)}`,
          { headers: getReadHeaders() },
        );
        if (!contentResponse.ok) {
          const errorData = await contentResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to load code file.");
        }
        return {
          path: filePath,
          content: await contentResponse.text(),
          sha: item.sha,
        };
      },
      commitCodeFile: async (filePath, content, message) => {
        setWriteError(null);
        setAuthError(null);
        const branch = activeRepoRef;
        const currentFile = await window.__DIFF_E2E__!.getCodeFile(filePath);
        const response = await fetch(
          `/api/repo/content?owner=${currentOwner}&repo=${currentRepo}`,
          {
            method: "PUT",
            headers: getWriteHeaders(),
            body: JSON.stringify({
              path: filePath,
              content,
              message,
              branch,
              sha: currentFile.sha,
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Server responded with ${response.status}`);
        }
        return {
          path: filePath,
          sha: typeof data.content?.sha === "string" ? data.content.sha : undefined,
        };
      },
      createCodeFile: async (filePath, content, message) => {
        setWriteError(null);
        setAuthError(null);
        const branch = activeRepoRef;
        const response = await fetch(
          `/api/repo/content?owner=${currentOwner}&repo=${currentRepo}`,
          {
            method: "PUT",
            headers: getWriteHeaders(),
            body: JSON.stringify({
              path: filePath,
              content,
              message,
              branch,
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Server responded with ${response.status}`);
        }
        return {
          path: filePath,
          sha: typeof data.content?.sha === "string" ? data.content.sha : undefined,
        };
      },
      writeSessionFile: async () => {
        const { data: sessionData, error: sessionError } = supabase
          ? await supabase.auth.getSession()
          : { data: { session: authSession }, error: null };
        if (sessionError) {
          throw sessionError;
        }
        const sessionSnapshot = sessionData.session ?? authSession;
        if (!sessionSnapshot) {
          throw new Error("No active Supabase session snapshot is available.");
        }
        const response = await fetch("/api/dev/e2e-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionSnapshot),
        });
        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(responseData.error || "Failed to write e2e session file.");
        }
        return responseData;
      },
    };

    return () => {
      delete window.__DIFF_E2E__;
    };
  }, [
    activeTab,
    authLoading,
    authError,
    authMenuOpen,
    authSession,
    authUser,
    currentOwner,
    currentRepo,
    defaultRepo,
    githubProviderToken,
    isSidebarOpen,
    isStreamFocus,
    loading,
    preferencesLoading,
    preferencesSyncing,
    preferencesSetupHint,
    pulls,
    files,
    recentRepos.length,
    reviewComments,
    savedPulls.length,
    selectedPull,
    selectedFile,
    showUpdates,
    theme,
    availableReviewLines,
    activeRepoRef,
    writeError,
  ]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth < 100) {
        setIsSidebarHidden(true);
        setIsResizing(false);
      } else if (newWidth >= 200 && newWidth <= 800) {
        if (isSidebarHidden) setIsSidebarHidden(false);
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isVerified) return;
    if (authLoading) return;
    if (!canReadRemoteRepo) return;
    fetchRepoInfo();
  }, [currentOwner, currentRepo, isVerified, authLoading, canReadRemoteRepo, readAuthKey]);

  useEffect(() => {
    if (!isVerified) return;
    if (authLoading) return;
    if (!canReadRemoteRepo) {
      setLoading(false);
      setLoadingMore(false);
      setLoadingRepoTree(false);
      return;
    }
    setPage(1);
    if (viewMode === "pulls") {
      fetchPulls(1, true);
    } else if (viewMode === "branches") {
      fetchBranches(1, true);
    } else {
      fetchRepoTree(undefined, {
        preservePull: Boolean(selectedPullNumberRef.current && repoTargetBranch.trim()),
        preferredPath:
          selectedFileNameRef.current ??
          selectedRepoFilePathRef.current ??
          undefined,
      });
    }
  }, [viewMode, stateFilter, currentOwner, currentRepo, repoTargetBranch, isVerified, authLoading, canReadRemoteRepo, readAuthKey]);

  const fetchRepoInfo = async () => {
    if (!canReadRemoteRepo) return null;
    const requestKey = `${currentOwner}/${currentRepo}`;
    try {
      const res = await fetch(
        `/api/repo?owner=${currentOwner}&repo=${currentRepo}`,
        { headers: getReadHeaders() },
      );
      if (res.ok) {
        const data: RepoInfo = await res.json();
        if (repoKeyRef.current !== requestKey) return null;
        setRepoInfo(data);
        return data;
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error("Repo info fetch error:", errorData.error || res.statusText);
      }
    } catch (err) {
      console.error("Repo info fetch error:", err);
    }
    return null;
  };

  const fetchBranches = async (pageNum = 1, reset = false) => {
    const requestKey = `${currentOwner}/${currentRepo}`;
    const selectedPullHeadRepo = selectedPull?.head?.repo?.full_name ?? null;
    const selectedPullHeadRef =
      reset && selectedPullHeadRepo === requestKey
        ? selectedPull?.head?.ref ?? null
        : null;
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    if (!canReadRemoteRepo) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    try {
      const comparisonRepoInfo = repoInfo ?? (await fetchRepoInfo());
      if (repoKeyRef.current !== requestKey) return;

      const response = await fetch(
        `/api/branches?page=${pageNum}&per_page=30&owner=${currentOwner}&repo=${currentRepo}`,
        { headers: getReadHeaders() },
      );
      if (repoKeyRef.current !== requestKey) return;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch branches");
      }
      const data: Branch[] = await response.json();
      if (repoKeyRef.current !== requestKey) return;

      const orderedData = reset ? moveBranchToFront(data, selectedPullHeadRef) : data;
      const newBranches = reset ? orderedData : [...branches, ...orderedData];
      setBranches(newBranches);
      setHasMore(data.length === 30);

      if (reset) {
        if (orderedData.length > 0) {
          handleSelectBranch(orderedData[0], comparisonRepoInfo);
        } else {
          setSelectedBranch(null);
          setFiles([]);
          setSelectedFile(null);
        }
      }
    } catch (err: any) {
      if (repoKeyRef.current !== requestKey) return;
      setError(err.message);
    } finally {
      if (repoKeyRef.current === requestKey) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const fetchRepoTree = async (
    refOverride?: string,
    options?: { preservePull?: boolean; preferredPath?: string },
  ) => {
    const requestKey = `${currentOwner}/${currentRepo}`;
    const shouldPreservePull = Boolean(options?.preservePull);
    const preferredPath =
      options?.preferredPath?.trim() ||
      (shouldPreservePull ? selectedFile?.filename ?? "" : "");
    setLoading(true);
    setLoadingRepoTree(true);
    setError(null);
    if (!shouldPreservePull) {
      selectedPullNumberRef.current = null;
      setSelectedPull(null);
      setSelectedBranch(null);
      setFiles([]);
      setSelectedFile(null);
      setComments([]);
      setReviewComments([]);
      setCommits([]);
      setReviews([]);
      setTimelineEvents([]);
      setContentEdits([]);
      setCheckRuns([]);
      setCheckSummary(null);
    }
    setActiveTab("diff");
    if (!canReadRemoteRepo) {
      setLoading(false);
      setLoadingRepoTree(false);
      return;
    }

    try {
      const comparisonRepoInfo = repoInfo ?? (await fetchRepoInfo());
      const ref = refOverride?.trim() || repoTargetBranch.trim() || comparisonRepoInfo?.default_branch || "HEAD";
      const response = await fetch(
        `/api/repo/tree?owner=${currentOwner}&repo=${currentRepo}&ref=${encodeURIComponent(ref)}`,
        { headers: getReadHeaders() },
      );
      if (repoKeyRef.current !== requestKey) return;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch repository tree");
      }

      const data = await response.json();
      if (repoKeyRef.current !== requestKey) return;
      const nextTree = Array.isArray(data.tree)
        ? data.tree
            .filter((item: RepoTreeItem) => item.path && item.type)
            .sort((a: RepoTreeItem, b: RepoTreeItem) => a.path.localeCompare(b.path))
        : [];
      setRepoTree(nextTree);
      setRepoTreeTruncated(Boolean(data.truncated));
      setHasMore(false);

      const firstFile =
        nextTree.find(
          (item: RepoTreeItem) => item.type === "blob" && item.path === preferredPath,
        ) ??
        nextTree.find((item: RepoTreeItem) => item.type === "blob") ??
        null;
      setSelectedRepoFile(firstFile);
      if (firstFile) {
        await loadRepoFile(firstFile, ref, requestKey);
      } else {
        setRepoFileContent(null);
      }
    } catch (err) {
      if (repoKeyRef.current !== requestKey) return;
      setError(err instanceof Error ? err.message : "Failed to fetch repository tree");
    } finally {
      if (repoKeyRef.current === requestKey) {
        setLoading(false);
        setLoadingRepoTree(false);
      }
    }
  };

  const loadRepoFile = async (
    file: RepoTreeItem,
    ref = activeRepoRef,
    requestKey = `${currentOwner}/${currentRepo}`,
  ) => {
    if (!canReadRemoteRepo) return;
    setSelectedRepoFile(file);
    setIsCreatingRepoFile(false);
    setRepoNewFilePath("");
    setAiDraftSummary(null);
    setActiveAiDraftId(null);
    setLoadingRepoFile(true);
    setRepoFileContent(null);

    try {
      const response = await fetch(
        `/api/repo/content?owner=${currentOwner}&repo=${currentRepo}&path=${encodeURIComponent(file.path)}&ref=${encodeURIComponent(ref)}`,
        { headers: getReadHeaders() },
      );
      if (repoKeyRef.current !== requestKey) return;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch file content");
      }
      const text = await response.text();
      if (repoKeyRef.current !== requestKey) return;
      setRepoFileContent(text);
      setRepoFileDraft(text);
      setIsEditingRepoFile(false);
      setRepoCommitMessage(`Update ${file.path}`);
    } catch (err) {
      if (repoKeyRef.current !== requestKey) return;
      const message = err instanceof Error ? err.message : "File content unavailable.";
      setRepoFileContent(message);
      setRepoFileDraft(message);
      setIsEditingRepoFile(false);
    } finally {
      if (repoKeyRef.current === requestKey) {
        setLoadingRepoFile(false);
      }
    }
  };

  const startCreateRepoFile = () => {
    setWriteError(null);
    setSelectedRepoFile(null);
    setRepoFileContent("");
    setRepoFileDraft("");
    setRepoNewFilePath("");
    setAiDraftSummary(null);
    setActiveAiDraftId(null);
    setRepoCommitMessage("Create file");
    setIsCreatingRepoFile(true);
    setIsEditingRepoFile(true);
  };

  const createRepoBranch = async () => {
    const base = repoInfo?.default_branch;
    const name = repoNewBranchName.trim();

    if (!base) {
      setWriteError("Base branch is unavailable.");
      return;
    }

    if (!name) {
      setWriteError("Branch name is required.");
      return;
    }

    setCreatingRepoBranch(true);
    setWriteError(null);
    setRepoPullUrl(null);

    try {
      const response = await fetch(
        `/api/repo/branch?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "POST",
          headers: getWriteHeaders(),
          body: JSON.stringify({ name, from: base }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Server responded with ${response.status}`);
      }

      setRepoTargetBranch(name);
      setRepoPullTitle((current) => current || `Update ${activeRepoFilePath || currentRepo}`);
      setRepoPullBody((current) => current || "Created from DIFF Code view.");
      if (selectedRepoFile && !isCreatingRepoFile) {
        await loadRepoFile(selectedRepoFile, name);
      }
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Failed to create branch.");
    } finally {
      setCreatingRepoBranch(false);
    }
  };

  const getRepoFileSha = async (filePath: string, ref: string) => {
    const response = await fetch(
      `/api/repo/tree?owner=${currentOwner}&repo=${currentRepo}&ref=${encodeURIComponent(ref)}`,
      { headers: getReadHeaders() },
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to read target branch tree.");
    }
    const data = await response.json();
    const item = Array.isArray(data.tree)
      ? data.tree.find((entry: RepoTreeItem) => entry.path === filePath && entry.type === "blob")
      : null;
    if (!item?.sha) {
      throw new Error(`File ${filePath} is not available on ${ref}.`);
    }
    return item.sha;
  };

  const commitRepoFile = async () => {
    if (repoFileContent == null) return;
    const filePath = activeRepoFilePath;
    const message = repoCommitMessage.trim();
    const branch = repoTargetBranch.trim() || repoInfo?.default_branch;

    if (!filePath) {
      setWriteError("File path is required.");
      return;
    }

    if (isInvalidRepoFilePath(filePath)) {
      setWriteError("Use a relative file path.");
      return;
    }

    if (!message) {
      setWriteError("Commit message is required.");
      return;
    }

    if (!branch) {
      setWriteError("Target branch is unavailable.");
      return;
    }

    if (!isCreatingRepoFile && repoFileDraft === repoFileContent) {
      setWriteError("No file changes to commit.");
      return;
    }

    setCommittingRepoFile(true);
    setWriteError(null);

    try {
      const currentSha = isCreatingRepoFile ? null : await getRepoFileSha(filePath, branch);
      const response = await fetch(
        `/api/repo/content?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "PUT",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            path: filePath,
            content: repoFileDraft,
            message,
            branch,
            ...(currentSha ? { sha: currentSha } : {}),
          }),
        },
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Server responded with ${response.status}`);
      }

      const nextSha = data.content?.sha;
      const nextFile: RepoTreeItem = {
        path: filePath,
        mode: "100644",
        type: "blob",
        sha: typeof nextSha === "string" ? nextSha : selectedRepoFile?.sha ?? "",
        size: new Blob([repoFileDraft]).size,
        url: "",
      };
      if (typeof nextSha === "string") {
        setRepoTree((current) =>
          current.some((item) => item.path === filePath)
            ? current.map((item) => (item.path === filePath ? { ...item, sha: nextSha, size: nextFile.size } : item))
            : [...current, nextFile].sort((a, b) => a.path.localeCompare(b.path)),
        );
      }

      setSelectedRepoFile(nextFile);
      setRepoFileContent(repoFileDraft);
      setAiDraftSummary(null);
      setActiveAiDraftId(null);
      setRepoNewFilePath("");
      setIsCreatingRepoFile(false);
      setIsEditingRepoFile(false);
      setRepoCommitMessage(`Update ${filePath}`);
      if (branch !== repoInfo?.default_branch) {
        setRepoPullTitle((current) => current || message);
      }
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Failed to commit file.");
    } finally {
      setCommittingRepoFile(false);
    }
  };

  const createRepoPullRequest = async () => {
    const base = repoInfo?.default_branch;
    const head = repoTargetBranch.trim();
    const title = repoPullTitle.trim();

    if (!base) {
      setWriteError("Base branch is unavailable.");
      return;
    }

    if (!head || head === base) {
      setWriteError("Create or select a working branch before opening a pull request.");
      return;
    }

    if (!title) {
      setWriteError("Pull request title is required.");
      return;
    }

    setCreatingRepoPull(true);
    setWriteError(null);
    setRepoPullUrl(null);

    try {
      const response = await fetch(
        `/api/pulls?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "POST",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            title,
            body: repoPullBody,
            head,
            base,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Server responded with ${response.status}`);
      }

      setRepoPullUrl(typeof data.html_url === "string" ? data.html_url : null);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Failed to open pull request.");
    } finally {
      setCreatingRepoPull(false);
    }
  };

  const saveRepoPullMetadata = async () => {
    if (!selectedPull) {
      setWriteError("Select a pull request before updating it.");
      return;
    }

    const title = repoPullTitle.trim();
    if (!title) {
      setWriteError("Pull request title is required.");
      return;
    }

    setSavingPullMeta(true);
    setWriteError(null);

    try {
      const response = await fetch(
        `/api/pulls/${selectedPull.number}?owner=${currentOwner}&repo=${currentRepo}`,
        {
          method: "PATCH",
          headers: getWriteHeaders(),
          body: JSON.stringify({
            title,
            body: repoPullBody,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Pull update failed with ${response.status}`);
      }

      const nextPull = {
        ...selectedPull,
        ...data,
        labels: data.labels ?? selectedPull.labels,
      } as PullRequest;
      selectedPullNumberRef.current = nextPull.number;
      setSelectedPull(nextPull);
      setPulls((current) =>
        orderPullsForStream(current.map((pull) => (pull.number === nextPull.number ? nextPull : pull))),
      );
      setSavedPulls((current) =>
        current.map((pull) =>
          pull.owner === currentOwner && pull.repo === currentRepo && pull.pull_number === nextPull.number
            ? {
                ...pull,
                title: nextPull.title,
                html_url: nextPull.html_url,
                state: nextPull.state,
                draft: Boolean(nextPull.draft),
              }
            : pull,
        ),
      );
      setRepoPullTitle(nextPull.title);
      setRepoPullBody(nextPull.body ?? "");
      setRepoPullUrl(nextPull.html_url);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Failed to update pull request.");
    } finally {
      setSavingPullMeta(false);
    }
  };

  const handleSelectBranch = async (
    branch: Branch,
    comparisonRepoInfo = repoInfo,
  ) => {
    const requestKey = `${currentOwner}/${currentRepo}`;
    setSelectedBranch(branch);
    selectedPullNumberRef.current = null;
    setSelectedPull(null);
    setLoadingFiles(true);
    setFiles([]);
    setSelectedFile(null);
    setComments([]);
    setReviewComments([]);
    setCommits([]);
    setTimelineEvents([]);
    setContentEdits([]);
    setCheckSummary(null);
    setCheckRuns([]);
    setActiveTab("diff");

    try {
      const base = comparisonRepoInfo?.default_branch;
      const head = branch.name;

      if (!base || base === head) {
        setFiles([]);
        setLoadingFiles(false);
        return;
      }

      const [filesRes, commitsRes] = await Promise.all([
        fetch(
          `/api/compare/${encodeURIComponent(base)}/${encodeURIComponent(head)}/files?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: getReadHeaders() },
        ),
        fetch(
          `/api/compare/${encodeURIComponent(base)}/${encodeURIComponent(head)}/commits?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: getReadHeaders() },
        ),
      ]);
      if (repoKeyRef.current !== requestKey) return;
      if (filesRes.ok) {
        const data = await filesRes.json();
        if (repoKeyRef.current !== requestKey) return;
        setFiles(data);
        if (data.length > 0) {
          setSelectedFile(data[0]);
        }
      }
      if (commitsRes.ok) {
        const data = await commitsRes.json();
        if (repoKeyRef.current !== requestKey) return;
        setCommits(data);
      }
    } catch (err) {
      if (repoKeyRef.current !== requestKey) return;
      console.error("Branch comparison files fetch error:", err);
    } finally {
      if (repoKeyRef.current === requestKey) {
        setLoadingFiles(false);
      }
    }
  };

  const clearSelectedPullData = () => {
    selectedPullNumberRef.current = null;
    setSelectedPull(null);
    setFiles([]);
    setSelectedFile(null);
    setComments([]);
    setReviewComments([]);
    setTimelineEvents([]);
    setContentEdits([]);
    setCheckSummary(null);
  };

  const fetchPulls = async (pageNum = 1, reset = false) => {
    const requestKey = `${currentOwner}/${currentRepo}`;
    const requestedStateFilter = stateFilter;
    const hasVisiblePulls = pulls.length > 0;
    const isCurrentPullListRequest = () =>
      repoKeyRef.current === requestKey &&
      viewModeRef.current === "pulls" &&
      stateFilterRef.current === requestedStateFilter;

    if (pageNum === 1) {
      setLoading(!hasVisiblePulls);
      setLoadingMore(false);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    if (!canReadRemoteRepo) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    try {
      const readHeaders = getReadHeaders();
      const response = await fetch(
        `/api/pulls?state=${requestedStateFilter}&page=${pageNum}&per_page=30&owner=${currentOwner}&repo=${currentRepo}`,
        { headers: readHeaders },
      );
      if (!isCurrentPullListRequest()) return;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404 && repoInfo) {
          const newPulls: PullRequest[] = reset ? [] : orderPullsForStream(pulls);
          pullCacheRef.current[requestedStateFilter] = newPulls;
          pullCacheLoadedRef.current[requestedStateFilter] = true;
          pullHasMoreCacheRef.current[requestedStateFilter] = false;
          setPulls(newPulls);
          setHasMore(false);

          if (reset) {
            clearSelectedPullData();
          }
          return;
        }
        let message =
          errorData.error || `Server responded with ${response.status}`;
        if (typeof message !== "string") {
          message = JSON.stringify(message);
        }
        if (message.includes("rate limit")) {
          throw new Error(
            githubProviderToken
              ? "GitHub API rate limit exceeded. Sign out and sign in again to refresh GitHub access."
              : "GitHub access is not ready. Sign in with GitHub to load pull requests.",
          );
        }
        throw new Error(message);
      }
      const data: PullRequest[] = await response.json();
      if (!isCurrentPullListRequest()) return;

      const newPulls = orderPullsForStream(reset ? data : [...pulls, ...data]);
      pullCacheRef.current[requestedStateFilter] = newPulls;
      pullCacheLoadedRef.current[requestedStateFilter] = true;
      pullHasMoreCacheRef.current[requestedStateFilter] = data.length === 30;
      setPulls(newPulls);
      setHasMore(data.length === 30);

      if (reset) {
        const pendingSavedPull = pendingSavedPullRef.current;
        const shouldKeepPendingSelection =
          pendingSavedPull &&
          pendingSavedPull.owner === currentOwner &&
          pendingSavedPull.repo === currentRepo;

        if (newPulls.length > 0) {
          if (!shouldKeepPendingSelection) {
            handleSelectPull(newPulls[0]);
          }
        } else {
          if (!shouldKeepPendingSelection) {
            clearSelectedPullData();
          }
        }
      }
    } catch (err: any) {
      if (!isCurrentPullListRequest()) return;
      setError(err.message);
    } finally {
      if (isCurrentPullListRequest()) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const changeStateFilter = (nextFilter: PullStateFilter) => {
    if (nextFilter === stateFilter) return;

    setPage(1);
    setError(null);
    setLoadingMore(false);
    setStateFilter(nextFilter);

    if (pullCacheLoadedRef.current[nextFilter]) {
      const cachedPulls = pullCacheRef.current[nextFilter];
      setPulls(cachedPulls);
      setHasMore(pullHasMoreCacheRef.current[nextFilter]);
      if (cachedPulls[0]) {
        handleSelectPull(cachedPulls[0]);
      } else {
        clearSelectedPullData();
      }
      return;
    }

    setPulls([]);
    setHasMore(false);
    clearSelectedPullData();
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    if (viewMode === "pulls") {
      fetchPulls(nextPage);
    } else {
      fetchBranches(nextPage);
    }
  };

  const handleSelectPull = async (pull: PullRequest) => {
    const requestKey = `${currentOwner}/${currentRepo}`;
    setViewMode("pulls");
    selectedPullNumberRef.current = pull.number;
    setSelectedPull(pull);
    setSelectedBranch(null);
    setLoadingFiles(true);
    setLoadingComments(true);
    setWriteError(null);
    setNewReviewCommentBody("");
    setReviewCommentLine("");
    setReviewCommentStartLine("");
    setNewReviewBody("");
    setFiles([]);
    setSelectedFile(null);
    setComments([]);
    setReviewComments([]);
    setTimelineEvents([]);
    setContentEdits([]);
    setCheckRuns([]);
    setCheckSummary(null);
    setActiveTab("diff");
    try {
      const readHeaders = getReadHeaders();
      const checksRequest = fetch(
        `/api/pulls/${pull.number}/checks?owner=${currentOwner}&repo=${currentRepo}`,
        { headers: readHeaders },
      )
        .then(async (checksRes) => {
          if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pull.number) return;
          if (!checksRes.ok) return;
          const data = await checksRes.json();
          if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pull.number) return;
          setCheckRuns(data.check_runs || []);
          setCheckSummary({
            mergeable: data.mergeable,
            merge_state_status: data.merge_state_status,
          });
        })
        .catch((err) => {
          if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pull.number) return;
          console.error("PR checks fetch error:", err);
        });

      const [pullRes, filesRes, commentsRes, reviewCommentsRes, commitsRes, reviewsRes, timelineRes, editsRes] = await Promise.all([
        fetch(
          `/api/pulls/${pull.number}?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/files?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/comments?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/review-comments?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/commits?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/reviews?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/timeline?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
        fetch(
          `/api/pulls/${pull.number}/edits?owner=${currentOwner}&repo=${currentRepo}`,
          { headers: readHeaders },
        ),
      ]);

      if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pull.number) return;

      if (pullRes.ok) {
        const pullData = await pullRes.json();
        const nextPull = { ...pull, ...pullData } as PullRequest;
        setSelectedPull(nextPull);
        setPulls((current) =>
          orderPullsForStream(current.map((item) => (item.number === nextPull.number ? nextPull : item))),
        );
      }

      // Process Files
      if (filesRes.ok) {
        const data = await filesRes.json();
        setFiles(data);
        if (data.length > 0) setSelectedFile(data[0]);
      }

      // Process Comments
      if (commentsRes.ok) setComments(await commentsRes.json());
      if (reviewCommentsRes.ok) setReviewComments(await reviewCommentsRes.json());

      // Process Commits & Reviews
      if (commitsRes.ok) setCommits(await commitsRes.json());
      if (reviewsRes.ok) setReviews(await reviewsRes.json());
      if (timelineRes.ok) setTimelineEvents(await timelineRes.json());
      if (editsRes.ok) setContentEdits(await editsRes.json());

      await checksRequest;
    } catch (err) {
      if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pull.number) return;
      console.error("PR data fetch error:", err);
    } finally {
      if (repoKeyRef.current === requestKey && selectedPullNumberRef.current === pull.number) {
        setLoadingFiles(false);
        setLoadingComments(false);
      }
    }
  };

  const refreshSelectedPullSnapshot = async (pullNumber: number) => {
    const requestKey = `${currentOwner}/${currentRepo}`;

    try {
      const readHeaders = getReadHeaders();
      const [
        pullRes,
        filesRes,
        commentsRes,
        reviewCommentsRes,
        checksRes,
        commitsRes,
        reviewsRes,
        timelineRes,
        editsRes,
      ] = await Promise.all([
        fetch(`/api/pulls/${pullNumber}?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/files?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/comments?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/review-comments?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/checks?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/commits?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/reviews?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/timeline?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
        fetch(`/api/pulls/${pullNumber}/edits?owner=${currentOwner}&repo=${currentRepo}`, { headers: readHeaders }),
      ]);

      if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pullNumber) return;

      if (pullRes.ok) {
        const pull = await pullRes.json();
        setSelectedPull(pull);
        setPulls((current) =>
          orderPullsForStream(current.map((item) => (item.number === pull.number ? pull : item))),
        );
      }

      if (filesRes.ok) {
        const nextFiles = await filesRes.json();
        setFiles(nextFiles);
        setSelectedFile((current) => {
          if (!current) return nextFiles[0] ?? null;
          return nextFiles.find((file: ChangedFile) => file.filename === current.filename) ?? nextFiles[0] ?? null;
        });
      }

      if (commentsRes.ok) setComments(await commentsRes.json());
      if (reviewCommentsRes.ok) setReviewComments(await reviewCommentsRes.json());
      if (commitsRes.ok) setCommits(await commitsRes.json());
      if (reviewsRes.ok) setReviews(await reviewsRes.json());
      if (timelineRes.ok) setTimelineEvents(await timelineRes.json());
      if (editsRes.ok) setContentEdits(await editsRes.json());

      if (checksRes.ok) {
        const data = await checksRes.json();
        setCheckRuns(data.check_runs || []);
        setCheckSummary({
          mergeable: data.mergeable,
          merge_state_status: data.merge_state_status,
        });
      }

      setLiveLastUpdate(new Date().toISOString());
    } catch (err) {
      if (repoKeyRef.current !== requestKey || selectedPullNumberRef.current !== pullNumber) return;
      console.error("Live pull refresh error:", err);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || !isVerified || viewMode !== "pulls") return;

    let refreshInFlight = false;
    let refreshQueued = false;
    let isClosed = false;
    let fallbackTimer: number | null = null;
    let liveHandshakeTimer: number | null = null;
    let socket: WebSocket | null = null;

    const refreshLiveData = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      do {
        refreshQueued = false;
        if (selectedPull) {
          await refreshSelectedPullSnapshot(selectedPull.number);
        } else {
          await fetchPulls(1, true);
          setLiveLastUpdate(new Date().toISOString());
        }
      } while (refreshQueued && !isClosed);
      refreshInFlight = false;
    };

    const startHttpFallback = () => {
      if (isClosed || fallbackTimer) return;
      if (liveHandshakeTimer) {
        window.clearTimeout(liveHandshakeTimer);
        liveHandshakeTimer = null;
      }
      if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
        socket.close();
      }
      void refreshLiveData();
      fallbackTimer = window.setInterval(() => {
        void refreshLiveData();
      }, 15000);
    };

    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/live`);
      liveHandshakeTimer = window.setTimeout(() => {
        startHttpFallback();
      }, 3500);

      socket.addEventListener("open", () => {
        if (isClosed || !socket || fallbackTimer) return;
        socket.send(JSON.stringify({
          type: "subscribe",
          owner: currentOwner,
          repo: currentRepo,
          pullNumber: selectedPull?.number ?? null,
        }));
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "subscribed") {
            if (liveHandshakeTimer) {
              window.clearTimeout(liveHandshakeTimer);
              liveHandshakeTimer = null;
            }
            return;
          }
          if (message.type !== "refresh") return;
          if (message.owner !== currentOwner || message.repo !== currentRepo) return;
          if (selectedPull && message.pullNumber && message.pullNumber !== selectedPull.number) return;
          void refreshLiveData();
        } catch {
          // Ignore malformed live messages; the next valid tick will refresh state.
        }
      });

      socket.addEventListener("close", () => {
        startHttpFallback();
      });

      socket.addEventListener("error", () => {
        startHttpFallback();
      });
    } catch {
      startHttpFallback();
    }

    return () => {
      isClosed = true;
      if (liveHandshakeTimer) {
        window.clearTimeout(liveHandshakeTimer);
      }
      if (fallbackTimer) {
        window.clearInterval(fallbackTimer);
      }
      if (socket?.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket?.close(), { once: true });
      } else {
        socket?.close();
      }
    };
  }, [currentOwner, currentRepo, isVerified, selectedPull?.number, stateFilter, viewMode]);

  if (!isVerified) {
    return (
      <div className="fixed inset-0 bg-onyx z-[100] flex items-center justify-center p-6 font-mono">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full max-w-[240px] space-y-4 text-center"
        >
          <div className="text-[10px] uppercase tracking-[0.4em] opacity-20 font-bold mb-8">
            Access Verification
          </div>

          <div className="text-xl tracking-tighter text-white/40 mb-4">
            {captchaChallenge.a} + {captchaChallenge.b}
          </div>

            <div className="flex bg-white/5 p-1 rounded-2xl">
              <input
                type="text"
                value={captchaInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setCaptchaInput(val);
                  if (parseInt(val) === captchaChallenge.sum) {
                    setIsVerified(true);
                  }
                }}
                autoFocus
                className="w-full bg-transparent p-4 text-center text-xl text-brand-orange outline-none transition-colors placeholder:text-white/5 font-bold"
                placeholder="?"
              />
            </div>

          <div className="text-[8px] uppercase tracking-[0.2em] opacity-10 pt-4">
            Awaiting input
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      onMouseDownCapture={preventMouseFocusOnClickControls}
      className="min-h-screen bg-onyx text-off-white font-sans selection:bg-brand-orange selection:text-off-white"
    >
      {/* Structural Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-grid-white/[0.5]" />
      </div>

      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b border-white/5 bg-onyx/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 lg:px-12 h-12 lg:h-14 flex items-center justify-between gap-2 lg:gap-2.5">
          <div className="flex items-center gap-2 lg:gap-4 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label={isSidebarOpen ? "Close navigation panel" : "Open navigation panel"}
              className="group -ml-1 p-1 text-white/40 transition-colors hover:text-white/55 lg:hidden"
            >
              <Activity
                className={cn(
                  "h-4 w-4 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] sm:h-5 sm:w-5",
                  isSidebarOpen && "rotate-90",
                )}
              />
            </button>
            <div className="group/brand flex min-w-0 items-center gap-2 lg:gap-3">
              <img
                src={DIFF_LOGO_URL}
                alt=""
                className="h-4 w-4 shrink-0 rounded-sm object-contain opacity-40 transition-all duration-300 ease-out group-hover/brand:-translate-y-px group-hover/brand:scale-[1.03] group-hover/brand:opacity-55"
              />
              <div className="flex flex-col min-w-0">
                <h1 className="text-base lg:text-xl font-mono tracking-tighter leading-none group cursor-default flex items-baseline">
                  DIFF
                  <span className="hidden lg:inline text-[7px] opacity-[0.08] ml-2.5 tracking-[0.36em] font-mono">
                    PROTOTYPE
                  </span>
                </h1>
              </div>
            </div>
          </div>

            <div className="flex items-center gap-2 lg:gap-2.5">
              <div className="flex items-center gap-1.5 lg:gap-2">
                <Tooltip content={`Theme: ${theme}`}>
                <button
                  type="button"
                  data-e2e="theme-toggle"
                  onClick={() => {
                  const themes: ThemePreference[] = ["dark", "midnight", "grey", "graphite"];
                  const currentIndex = themes.indexOf(theme);
                  const nextIndex = (currentIndex + 1) % themes.length;
                  setTheme(themes[nextIndex]);
                }}
                  className="group flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.012] px-2 transition-colors hover:border-white/[0.08] hover:bg-white/[0.025]"
              >
                <Palette className="h-3.5 w-3.5 text-white/25 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:rotate-[-2deg] group-hover:scale-[1.04] group-hover:text-white/45" />
                <div className="flex gap-1 px-0.5">
                  <div className={cn("w-1 h-1 lg:w-1.5 lg:h-1.5 rounded-full transition-colors duration-200", theme === "dark" ? "bg-brand-orange" : "bg-white/10")} />
                  <div className={cn("w-1 h-1 lg:w-1.5 lg:h-1.5 rounded-full transition-colors duration-200", theme === "midnight" ? "bg-brand-orange" : "bg-white/10")} />
                  <div className={cn("w-1 h-1 lg:w-1.5 lg:h-1.5 rounded-full transition-colors duration-200", theme === "grey" ? "bg-brand-orange" : "bg-white/10")} />
                  <div className={cn("w-1 h-1 lg:w-1.5 lg:h-1.5 rounded-full transition-colors duration-200", theme === "graphite" ? "bg-brand-orange" : "bg-white/10")} />
                </div>
              </button>
                </Tooltip>

                <Tooltip content="Updates">
                <button
                  data-e2e="updates-open"
                  onClick={() => {
                    setShowUpdates(true);
                  setHasNewUpdates(false);
                }}
                  className="group relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.04] bg-white/[0.012] transition-all hover:border-white/[0.08] hover:bg-white/[0.025]"
              >
                <div className={cn(
                  "absolute right-2 top-2 h-1.5 w-1.5 rounded-full",
                  hasNewUpdates ? "bg-brand-orange animate-pulse" : "bg-white/10 group-hover:bg-white/30"
                )} />
                  <Package className="h-3.5 w-3.5 text-white/25 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:rotate-[-2deg] group-hover:scale-[1.04] group-hover:text-white/45" />
                </button>
                </Tooltip>
              </div>

              <div className="relative shrink-0" ref={authMenuRef}>
                {authUser ? (
                  <>
                    <button
                      data-e2e="auth-menu-toggle"
                      onClick={() => {
                        setAuthMenuOpen((current) => !current);
                        setAuthError(null);
                      }}
                      className="group flex max-w-[168px] items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.015] px-2 py-1.5 text-left transition-colors hover:border-white/[0.08] hover:bg-white/[0.03] lg:max-w-[182px]"
                    >
                      {authAvatarUrl ? (
                        <img
                          src={authAvatarUrl}
                          alt={authDisplayName}
                          className="h-6 w-6 rounded-full object-cover transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-white/40 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.03]">
                          <User className="h-3.5 w-3.5" />
                        </div>
                      )}
                      <div className="hidden min-w-0 sm:block">
                        <div className="truncate text-[8px] font-medium uppercase tracking-[0.15em] text-white/50">
                          {authDisplayName}
                        </div>
                        <div className="truncate text-[7px] uppercase tracking-[0.15em] text-white/15">
                          {preferencesLoading ? "syncing" : authProvider}
                        </div>
                      </div>
                    </button>

                    <AnimatePresence>
                      {authMenuOpen && (
                        <motion.div
                          data-e2e="auth-menu"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          className="absolute right-0 top-[calc(100%+8px)] w-[220px] rounded-xl border border-white/8 bg-panel/95 p-2.5 shadow-2xl backdrop-blur-md"
                        >
                          <div className="space-y-0.5 border-b border-white/5 pb-2">
                            <div className="text-[9px] uppercase tracking-[0.24em] text-white/20">
                              Signed in
                            </div>
                            <div className="truncate text-[11px] font-medium text-white/85">
                              {authDisplayName}
                            </div>
                            {authUser?.email && (
                              <div className="truncate text-[10px] text-white/35">
                                {authUser.email}
                              </div>
                            )}
                            <div className="text-[8px] uppercase tracking-[0.16em] text-white/18">
                              {preferencesLoading ? "sync active" : "sync ready"} · {githubProviderToken ? "write enabled" : "write unavailable"}
                            </div>
                          </div>

                          <div className="space-y-2 border-b border-white/5 py-2">
                            <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-white/20">
                              <span>Saved Pulls</span>
                              {savedPulls.length > 0 && <span>{savedPulls.length}</span>}
                            </div>
                            {savedPulls.length > 0 ? (
                              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                                {savedPulls.slice(0, MAX_SAVED_PULLS).map((pull) => (
                                  <a
                                    key={`${pull.owner}/${pull.repo}#${pull.pull_number}`}
                                    href={pull.html_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block rounded-lg px-2 py-1.5 text-white/45 transition-colors hover:bg-white/[0.03] hover:text-white/75"
                                  >
                                    <div className="truncate text-[10px] font-medium">
                                      {pull.title}
                                    </div>
                                    <div className="truncate text-[9px] uppercase tracking-[0.16em] text-white/20">
                                      {pull.owner}/{pull.repo} #{pull.pull_number}
                                    </div>
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[9px] uppercase tracking-[0.18em] text-white/20">
                                No saved pull requests
                              </div>
                            )}
                          </div>

                          <div className="pt-2">
                            <div className="mb-2 grid grid-cols-2 gap-1">
                              <a
                                href="https://github.com/coccinella-labs/diff/blob/main/docs/legal/privacy.md"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/25 transition-colors hover:bg-white/[0.03] hover:text-white/55"
                              >
                                Privacy
                              </a>
                              <a
                                href="https://github.com/coccinella-labs/diff/blob/main/docs/legal/terms.md"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/25 transition-colors hover:bg-white/[0.03] hover:text-white/55"
                              >
                                Terms
                              </a>
                            </div>
                            <div className="mb-1.5 border-t border-white/5" />
                            {recentRepos.length > 0 && (
                              <button
                                type="button"
                                onClick={clearRecentRepos}
                                aria-label="Clear recent repositories"
                                className="group mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 transition-colors hover:bg-white/[0.03] hover:text-white/70"
                              >
                                Clear repos
                                <Trash2 className="h-3.5 w-3.5 opacity-45 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] group-hover:opacity-80" />
                              </button>
                            )}
                            <button
                              onClick={signOut}
                              className="group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 transition-colors hover:bg-white/[0.03] hover:text-white/70"
                            >
                              Sign Out
                              <LogOut className="h-3.5 w-3.5 opacity-45 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:translate-x-px group-hover:scale-[1.04] group-hover:opacity-80" />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <Tooltip
                    content={
                      isSupabaseConfigured
                        ? "Sign in with GitHub via Supabase"
                        : "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable auth"
                    }
                  >
                    <span className="inline-flex">
                      <button
                        onClick={beginGitHubSignIn}
                        disabled={!isSupabaseConfigured || authLoading}
                        className="group flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/40 transition-colors hover:border-white/10 hover:bg-white/[0.04] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Lock className={cn("h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:rotate-[-2deg] group-hover:scale-[1.04]", authLoading && isSupabaseConfigured && "animate-pulse")} />
                        <span className="hidden sm:inline">
                          {authLoading ? "Auth" : "Sign In"}
                        </span>
                      </button>
                    </span>
                  </Tooltip>
                )}

                {preferencesSetupHint && (
                  <div className="absolute right-0 top-[calc(100%+8px)] max-w-[260px] text-[9px] uppercase tracking-[0.18em] text-amber-300/60">
                    {preferencesSetupHint}
                  </div>
                )}

                {authError && !preferencesSetupHint && (
                  <div className="absolute right-0 top-[calc(100%+8px)] max-w-[220px] text-[9px] uppercase tracking-[0.18em] text-rose-400/70">
                    {authError}
                  </div>
                )}
              </div>

            <div className="hidden lg:flex items-center text-[9px] font-medium uppercase tracking-[0.22em] text-white/22">
              <Tooltip content="Open GitHub repo">
              <a
                href="https://github.com/coccinella-labs/diff"
                target="_blank"
                rel="noreferrer"
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.04] bg-white/[0.012] transition-colors hover:border-white/[0.08] hover:bg-white/[0.025] hover:text-white/42"
              >
                <ExternalLink className="h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:scale-[1.04]" />
              </a>
              </Tooltip>
            </div>

            <Tooltip content={isSidebarHidden ? "Show panel" : "Hide panel"}>
            <button
              onClick={() => setIsSidebarHidden(!isSidebarHidden)}
              className="group hidden h-9 w-9 items-center justify-center rounded-lg border border-white/[0.04] bg-white/[0.012] text-white/25 transition-colors hover:border-white/[0.08] hover:bg-white/[0.025] hover:text-white/55 lg:flex"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:translate-x-px group-hover:scale-[1.04]",
                  isSidebarHidden ? "rotate-0" : "rotate-180",
                )}
              />
            </button>
            </Tooltip>
          </div>

          <Tooltip
            content={
              viewMode === "pulls" && liveLastUpdate
                ? `Refresh. Last live update ${new Date(liveLastUpdate).toLocaleTimeString()}`
                : "Refresh"
            }
          >
            <button
              onClick={() =>
                viewMode === "pulls"
                  ? fetchPulls(1, true)
                  : viewMode === "branches"
                    ? fetchBranches()
                    : fetchRepoTree(undefined, {
                        preservePull: Boolean(selectedPullNumberRef.current && repoTargetBranch.trim()),
                        preferredPath: selectedFile?.filename ?? selectedRepoFile?.path,
                      })
              }
              className="p-2 lg:p-2.5 border border-white/[0.05] bg-white/[0.01] hover:border-white/[0.1] hover:bg-white/[0.025] transition-all group shrink-0 rounded-lg"
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5 lg:w-4 lg:h-4 text-white/40 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:rotate-[-8deg] group-hover:scale-[1.04] group-hover:text-brand-orange",
                  loading && "animate-spin",
                )}
              />
            </button>
          </Tooltip>
        </div>
      </header>
<AnimatePresence>
  {isSidebarOpen && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => setIsSidebarOpen(false)}
      className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
    />
  )}
</AnimatePresence>
      <main
        className={cn(
          "pt-12 lg:pt-14 h-screen flex overflow-hidden bg-onyx",
          isResizing && "select-none cursor-col-resize",
        )}
        style={
          { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
        }
      >
        {/* Pull Requests List */}
        <aside
          style={{
            width: isSidebarHidden ? 0 : undefined,
            transition: isResizing ? 'none' : undefined
          }}
          className={cn(
            "border-r border-white/5 bg-panel/90 backdrop-blur-md flex flex-col relative group overflow-hidden",
            isSidebarOpen ? "z-50" : "z-40",
            !isResizing && "transition-all duration-300 ease-in-out",
            "fixed lg:relative top-12 lg:top-0 bottom-0 left-0 lg:bottom-auto lg:inset-auto bg-onyx lg:bg-panel/90",
            isSidebarOpen
              ? "w-[280px] sm:w-[320px] translate-x-0"
              : "w-0 lg:w-auto -translate-x-full lg:translate-x-0",
            !isSidebarHidden && "lg:w-[var(--sidebar-width)]",
          )}
        >
          <div className="flex flex-col h-full overflow-hidden w-[280px] sm:w-[320px] lg:w-[var(--sidebar-width)]">
            {!isStreamFocus && (
            <div className="border-b border-white/5 px-4 py-3 lg:px-4 lg:py-3 space-y-3">
              {/* Repository Switcher moved here */}
              <div className="flex items-center gap-2 min-w-0">
                {showRepoInput ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex-1 flex items-center"
                  >
                    <input
                      type="text"
                      value={inputRepo}
                      onChange={(e) => setInputRepo(e.target.value)}
                      onBlur={() => {
                        if (!inputRepo) setShowRepoInput(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const [owner, repo] = inputRepo.split("/");
                          if (owner && repo) {
                            switchRepo(owner, repo);
                            setShowRepoInput(false);
                          }
                        } else if (e.key === "Escape") {
                          setShowRepoInput(false);
                        }
                      }}
                      autoFocus
                      placeholder="owner/repo"
                      className="bg-black/20 border border-white/10 px-3 py-2 text-[10px] font-mono text-white/80 outline-none focus:border-brand-orange/40 w-full rounded-lg"
                    />
                  </motion.div>
                ) : (
                  <div className="flex-1 flex items-start justify-between gap-3 min-w-0">
                    <button
                      onClick={() => {
                        setInputRepo(`${currentOwner}/${currentRepo}`);
                        setShowRepoInput(true);
                      }}
                      className="text-[9px] lg:text-[10px] font-mono whitespace-nowrap text-white/35 hover:text-white/70 transition-colors flex items-center gap-1.5 group min-w-0 overflow-hidden"
                    >
                      <Hash className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">
                        {currentOwner}/{currentRepo}
                      </span>
                      <ArrowLeftRight className="ml-1 h-2.5 w-2.5 text-white/25 opacity-0 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:translate-x-px group-hover:scale-[1.04] group-hover:text-white/55 group-hover:opacity-100" />
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(currentOwner !== defaultRepo.owner ||
                        currentRepo !== defaultRepo.repo) && (
                        <>
                          <button
                            onClick={() => {
                              const newDefault = { owner: currentOwner, repo: currentRepo };
                              setDefaultRepo(newDefault);
                            }}
                            className="px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/30 hover:text-white/70 transition-colors shrink-0 border border-white/5 rounded-md"
                          >
                            Pin
                          </button>
                          <button
                            onClick={() => {
                              switchRepo(defaultRepo.owner, defaultRepo.repo);
                            }}
                            className="px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/30 hover:text-white/70 transition-colors shrink-0 border border-white/5 rounded-md"
                          >
                            Default
                          </button>
                        </>
                      )}

                      {(defaultRepo.owner !== SYSTEM_OWNER || defaultRepo.repo !== SYSTEM_REPO) && (
                        <Tooltip content="Reset to system default">
                          <button
                            onClick={() => {
                              const systemDefault = { owner: SYSTEM_OWNER, repo: SYSTEM_REPO };
                              setDefaultRepo(systemDefault);
                              switchRepo(SYSTEM_OWNER, SYSTEM_REPO);
                            }}
                            className="px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-rose-400/60 hover:text-rose-300 transition-colors shrink-0 border border-rose-500/10 rounded-md"
                          >
                            Clear
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {isSupabaseConfigured && (
                <div data-e2e="sidebar-account" className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setIsSidebarAccountOpen((current) => !current)}
                    className="group flex w-full items-center justify-between text-left"
                    aria-expanded={isSidebarAccountOpen}
                  >
                    <div className="text-[8px] uppercase tracking-[0.24em] text-white/20">
                      Account
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-white/20 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] group-hover:text-white/45",
                        isSidebarAccountOpen && "rotate-90",
                      )}
                    />
                  </button>
                  {isSidebarAccountOpen &&
                    (authUser ? (
                      <div className="flex items-center justify-between gap-2.5 rounded-xl border border-white/5 bg-black/15 px-2.5 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {authAvatarUrl ? (
                            <img
                              src={authAvatarUrl}
                              alt={authDisplayName}
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-white/35">
                              <User className="h-3 w-3" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-[9px] font-medium uppercase tracking-[0.16em] text-white/60">
                              {authDisplayName}
                            </div>
                            <div className="truncate text-[8px] uppercase tracking-[0.16em] text-white/18">
                              {savedPulls.length} saved · {githubProviderToken ? "write enabled" : "read only"}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={signOut}
                          className="shrink-0 rounded-md border border-white/5 px-2 py-1 text-[8px] uppercase tracking-[0.16em] text-white/30 transition-colors hover:border-white/10 hover:text-white/60"
                        >
                          Sign out
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={beginGitHubSignIn}
                        disabled={!isSupabaseConfigured || authLoading}
                        className="group flex w-full items-center justify-between rounded-xl border border-white/5 bg-black/15 px-2.5 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div>
                          <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/50">
                            Sign in with GitHub
                          </div>
                          <div className="text-[8px] uppercase tracking-[0.16em] text-white/18">
                            Sync settings and discussion actions
                          </div>
                        </div>
                        <Lock className="h-3.5 w-3.5 text-white/30 transition-all duration-300 ease-out group-hover:-translate-y-px group-hover:rotate-[-2deg] group-hover:scale-[1.04] group-hover:text-white/50" />
                      </button>
                    ))}
                </div>
              )}

              {authUser && recentRepos.length > 0 && (
                <div data-e2e="sidebar-recent-repos" className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setIsSidebarRecentReposOpen((current) => !current)}
                    className="group flex w-full items-center justify-between text-left"
                    aria-expanded={isSidebarRecentReposOpen}
                  >
                    <div className="text-[8px] uppercase tracking-[0.24em] text-white/20">
                      Recent Repos
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-white/20 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] group-hover:text-white/45",
                        isSidebarRecentReposOpen && "rotate-90",
                      )}
                    />
                  </button>
                  {isSidebarRecentReposOpen && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {recentRepos.slice(0, 4).map((entry) => {
                        const isActive =
                          entry.owner === currentOwner && entry.repo === currentRepo;
                        return (
                          <button
                            key={`${entry.owner}/${entry.repo}`}
                            onClick={() => switchRepo(entry.owner, entry.repo)}
                            className={cn(
                              "rounded-md border px-2 py-1 text-[8px] uppercase tracking-[0.16em] transition-colors",
                              isActive
                                ? "border-white/10 bg-white/[0.04] text-white/70"
                                : "border-white/5 text-white/30 hover:border-white/10 hover:text-white/55",
                            )}
                          >
                            {entry.owner}/{entry.repo}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {authUser && savedPulls.length > 0 && (
                <div data-e2e="sidebar-saved-pulls" className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setIsSidebarSavedPullsOpen((current) => !current)}
                    className="group flex w-full items-center justify-between text-left"
                    aria-expanded={isSidebarSavedPullsOpen}
                  >
                    <div className="text-[8px] uppercase tracking-[0.24em] text-white/20">
                      Saved Pulls
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-white/20 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] group-hover:text-white/45",
                        isSidebarSavedPullsOpen && "rotate-90",
                      )}
                    />
                  </button>
                  {isSidebarSavedPullsOpen && (
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                      {savedPulls.slice(0, MAX_SAVED_PULLS).map((savedPull) => (
                        <button
                          key={`${savedPull.owner}/${savedPull.repo}#${savedPull.pull_number}`}
                          onClick={() => openSavedPull(savedPull)}
                          className="w-full rounded-lg border border-white/5 bg-black/15 px-2.5 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/[0.02]"
                        >
                          <div className="truncate text-[9px] font-medium text-white/55">
                            {savedPull.title}
                          </div>
                          <div className="truncate pt-0.5 text-[8px] uppercase tracking-[0.14em] text-white/18">
                            {savedPull.owner}/{savedPull.repo} #{savedPull.pull_number}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-1 border border-white/5 bg-black/20 rounded-xl p-1">
                <button
                  onClick={() => setViewMode("pulls")}
                  className={cn(
                    "py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all relative rounded-lg",
                    viewMode === "pulls"
                      ? "bg-white/[0.04] text-white"
                      : "text-white/25 hover:text-white/45",
                  )}
                >
                  Pulls
                  {viewMode === "pulls" && (
                    <motion.div
                      layoutId="viewMode"
                      className="absolute inset-x-3 bottom-0 h-px bg-brand-orange"
                    />
                  )}
                </button>
                <button
                  onClick={() => setViewMode("branches")}
                  className={cn(
                    "py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all relative rounded-lg",
                    viewMode === "branches"
                      ? "bg-white/[0.04] text-white"
                      : "text-white/25 hover:text-white/45",
                  )}
                >
                  Branches
                  {viewMode === "branches" && (
                    <motion.div
                      layoutId="viewMode"
                      className="absolute inset-x-3 bottom-0 h-px bg-brand-orange"
                    />
                  )}
                </button>
                <button
                  onClick={() => {
                    setActiveTab("diff");
                    setRepoTargetBranch("");
                    setRepoPullUrl(null);
                    setAiDraftSummary(null);
                    setActiveAiDraftId(null);
                    selectedPullNumberRef.current = null;
                    setSelectedPull(null);
                    setSelectedBranch(null);
                    setViewMode("code");
                  }}
                  className={cn(
                    "py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all relative rounded-lg",
                    viewMode === "code"
                      ? "bg-white/[0.04] text-white"
                      : "text-white/25 hover:text-white/45",
                  )}
                >
                  {isPullBranchWorkspace ? "Branch" : "Code"}
                  {viewMode === "code" && (
                    <motion.div
                      layoutId="viewMode"
                      className="absolute inset-x-3 bottom-0 h-px bg-brand-orange"
                    />
                  )}
                </button>
              </div>
            </div>
            )}

            <div className={cn("px-4 lg:px-4 border-b border-white/5 shrink-0", isStreamFocus ? "py-2.5 space-y-0" : "py-3 space-y-3")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white/20">
                  <Activity className="w-3 h-3" />
                  <h2 className="text-[9px] font-bold uppercase tracking-[0.36em]">
                    {viewMode === "pulls" ? "Stream" : viewMode === "branches" ? "Network" : isPullBranchWorkspace ? "Branch" : "Explore"}
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 text-[9px] font-mono text-white/45 bg-white/[0.03] border border-white/5 rounded-md">
                    {viewMode === "pulls"
                      ? pulls.length
                      : viewMode === "branches"
                        ? branches.length
                        : repoFiles.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsStreamFocus((current) => !current)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[8px] uppercase tracking-[0.16em] transition-colors",
                      isStreamFocus
                        ? "border-brand-orange/20 text-brand-orange/75 hover:text-brand-orange"
                        : "border-white/5 text-white/25 hover:border-white/10 hover:text-white/55",
                    )}
                  >
                    {isStreamFocus ? "Show" : "Focus"}
                  </button>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="group lg:hidden"
                  >
                    <ChevronRight className="h-4 w-4 rotate-180 text-white/30 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] group-hover:text-white/55" />
                  </button>
                </div>
              </div>

              {!isStreamFocus && viewMode === "pulls" && (
                <div className="flex border border-white/5 p-1 bg-black/20 rounded-xl">
                  {(["open", "closed", "all"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => changeStateFilter(s)}
                      className={cn(
                        "flex-1 py-1.5 text-[8px] lg:text-[10px] uppercase tracking-[0.22em] font-bold transition-all rounded-lg",
                        stateFilter === s
                          ? "bg-white/[0.05] text-white"
                          : "text-white/30 hover:text-white/60",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {!isStreamFocus && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/18" />
                <input
                  type="search"
                  value={repoSearchQuery}
                  onChange={(event) => setRepoSearchQuery(event.target.value)}
                  placeholder={viewMode === "code" ? "Search repository" : "Search diffs"}
                  className="w-full rounded-xl border border-white/5 bg-black/20 py-2 pl-8 pr-3 text-[10px] font-mono text-white/60 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                />
              </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="h-10" aria-busy="true" aria-label="Loading" />
              ) : error ? (
                <div className="p-12 text-center space-y-4">
                  <p className="text-xs text-rose-500 font-mono">{error}</p>
                  <button
                    onClick={() =>
                      viewMode === "pulls"
                        ? fetchPulls(1, true)
                        : viewMode === "branches"
                          ? fetchBranches(1, true)
                          : fetchRepoTree(undefined, {
                              preservePull: Boolean(selectedPullNumberRef.current && repoTargetBranch.trim()),
                              preferredPath: selectedFile?.filename ?? selectedRepoFile?.path,
                            })
                    }
                    className="text-[10px] uppercase tracking-widest text-brand-orange border-b border-brand-orange/20"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {normalizedRepoSearchQuery && repoSearchResults.length > 0 && (
                    <div className="space-y-1.5 border-b border-white/5 pb-2">
                      {repoSearchResults.slice(0, 10).map((result) => (
                        <button
                          key={`${result.scope}-${result.path}`}
                          onClick={() => {
                            if (result.scope === "diff" && result.file) {
                              setActiveTab("diff");
                              setSelectedFile(result.file);
                            } else if (result.repoItem) {
                              setViewMode("code");
                              loadRepoFile(result.repoItem);
                            }
                            setIsSidebarOpen(false);
                          }}
                          className="w-full rounded-lg border border-white/5 bg-white/[0.012] px-3 py-2.5 text-left transition-colors hover:border-white/10 hover:bg-white/[0.025]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-[9px] font-mono text-white/50">
                              {result.path}
                            </span>
                            <span className="shrink-0 text-[7px] uppercase tracking-[0.18em] text-brand-orange/55">
                              {result.scope}
                            </span>
                          </div>
                          <div className="truncate pt-1 text-[8px] uppercase tracking-[0.14em] text-white/18">
                            {result.detail}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {viewMode === "pulls"
                    ? pulls.map((pull) => (
                        <button
                          key={pull.id}
                          onClick={() => {
                            handleSelectPull(pull);
                            setIsSidebarOpen(false);
                          }}
                          className={cn(
                            "w-full text-left p-4 lg:p-4 transition-all border border-transparent hover:border-white/5 hover:bg-white/[0.02] relative group rounded-xl",
                            selectedPull?.id === pull.id
                              ? "bg-white/[0.03] border-white/6"
                              : "",
                          )}
                        >
                          {selectedPull?.id === pull.id && (
                            <motion.div
                              layoutId="active-indicator"
                              className="absolute left-0 top-3 bottom-3 w-px bg-brand-orange"
                            />
                          )}

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[9px] font-mono text-white/30">
                              <span className="flex items-center gap-2">
                                #{pull.number}
                                {pull.draft && (
                                  <span className="text-[7px] font-mono px-1.5 py-0.5 border border-white/5 text-white/35 uppercase tracking-[0.22em] leading-tight rounded-md">
                                    Draft
                                  </span>
                                )}
                              </span>
                              <span className="hidden sm:block">
                                {new Date(pull.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            </div>

                            <h3
                              className={cn(
                                "font-serif italic text-base leading-tight transition-colors break-words",
                                selectedPull?.id === pull.id
                                  ? "text-white"
                                  : "text-white/60 group-hover:text-white",
                              )}
                            >
                              {pull.title}
                            </h3>

                            <div className="flex items-center gap-2">
                              <img
                                src={pull.user.avatar_url}
                                alt=""
                                className="w-4 h-4 grayscale opacity-30 group-hover:opacity-100 transition-opacity rounded-full"
                              />
                              <span className="text-[9px] tracking-[0.22em] text-white/20 group-hover:text-white/50 transition-colors font-bold uppercase">
                                {pull.user.login}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))
                    : viewMode === "branches"
                      ? branches.map((branch) => (
                        <button
                          key={branch.name}
                          onClick={() => {
                            handleSelectBranch(branch);
                            setIsSidebarOpen(false);
                          }}
                          className={cn(
                            "w-full text-left p-4 lg:p-4 transition-all border border-transparent hover:border-white/5 hover:bg-white/[0.02] relative group rounded-xl",
                            selectedBranch?.name === branch.name
                              ? "bg-white/[0.03] border-white/6"
                              : "",
                          )}
                        >
                          {selectedBranch?.name === branch.name && (
                            <motion.div
                              layoutId="active-indicator"
                              className="absolute left-0 top-3 bottom-3 w-px bg-brand-orange"
                            />
                          )}

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-mono text-white/35">
                              <span className="flex items-center gap-2">
                                <GitBranch className="w-3 h-3" />
                              </span>
                              {branch.name === repoInfo?.default_branch && (
                                <span className="text-[8px] font-bold uppercase tracking-[0.22em] text-[#00FF41]/55 px-1.5 py-0.5 border border-[#00FF41]/10 rounded-md">
                                  Default
                                </span>
                              )}
                            </div>

                            <h3
                              className={cn(
                                "font-serif italic text-base leading-tight transition-colors break-words",
                                selectedBranch?.name === branch.name
                                  ? "text-white"
                                  : "text-white/60 group-hover:text-white",
                              )}
                            >
                              {branch.name}
                            </h3>

                            <div className="flex items-center gap-3">
                              <span className="text-[9px] lg:text-[10px] text-white/35 font-mono truncate">
                                {branch.commit.sha.substring(0, 7)}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))
                      : visibleRepoFiles.map((file) => (
                        <button
                          key={file.path}
                          onClick={() => {
                            loadRepoFile(file);
                            setIsSidebarOpen(false);
                          }}
                          className={cn(
                            "w-full text-left p-3.5 lg:p-4 transition-all border border-transparent hover:border-white/5 hover:bg-white/[0.02] relative group rounded-xl",
                            selectedRepoFile?.path === file.path
                              ? "bg-white/[0.03] border-white/6"
                              : "",
                          )}
                        >
                          {selectedRepoFile?.path === file.path && (
                            <motion.div
                              layoutId="active-indicator"
                              className="absolute left-0 top-3 bottom-3 w-px bg-brand-orange"
                            />
                          )}

                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[9px] font-mono text-white/35">
                              <FileCode className="h-3 w-3 shrink-0 text-white/20" />
                              <span className="truncate">{file.path}</span>
                            </div>
                            <div className="text-[8px] uppercase tracking-[0.16em] text-white/16">
                              {file.size != null ? `${file.size.toLocaleString()} bytes` : "repository file"}
                            </div>
                          </div>
                        </button>
                      ))}

                  {viewMode === "code" && repoTreeTruncated && (
                    <div className="p-4 text-[9px] uppercase tracking-[0.18em] text-amber-300/45">
                      Repository tree is truncated by GitHub.
                    </div>
                  )}

                  {viewMode === "code" && !loadingRepoTree && visibleRepoFiles.length === 0 && (
                    <div className="p-8 text-center text-[10px] uppercase tracking-[0.2em] opacity-20 italic">
                      No repository files found
                    </div>
                  )}

                  {hasMore && viewMode !== "code" && (
                    <div className="p-6 flex justify-center">
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="group flex flex-col items-center gap-3 transition-all"
                      >
                        <div
                          className={cn(
                            "w-10 h-10 border border-white/10 flex items-center justify-center transition-all group-hover:border-white/20 group-hover:bg-white/[0.03] rounded-xl",
                            loadingMore && "animate-pulse",
                          )}
                        >
                          {loadingMore ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-brand-orange" />
                          ) : (
                            <ChevronRight className="h-4 w-4 rotate-90 text-white/40 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04] group-hover:text-white/55" />
                          )}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.4em] opacity-40 group-hover:opacity-100 transition-opacity">
                          Load More
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Resize Handle */}
        <div
          onMouseDown={() => setIsResizing(true)}
          className={cn(
            "hidden lg:block w-8 h-full cursor-col-resize transition-all z-50 group flex-shrink-0 relative",
            isResizing && "bg-white/[0.03]",
            isSidebarHidden && "w-10"
          )}
        >
          <div
            className={cn(
              "absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-px bg-white/5 group-hover:bg-white/15 transition-colors",
              isResizing && "bg-brand-orange/60",
            )}
          />
          <Tooltip
            content={isSidebarHidden ? "Show panel" : "Hide panel"}
            wrapperClassName="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            side="right"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsSidebarHidden(!isSidebarHidden);
              }}
              className="group flex h-14 w-7 items-center justify-center rounded-full border border-white/10 bg-panel/95 text-white/30 backdrop-blur-sm transition-colors hover:border-white/20 hover:text-white/60"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:translate-x-px group-hover:scale-[1.04]",
                  isSidebarHidden ? "rotate-0" : "rotate-180",
                )}
              />
            </button>
          </Tooltip>
        </div>

        {/* Diff Content View */}
        <section className="flex-1 min-h-full bg-onyx relative overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">
            {selectedPull || selectedBranch || viewMode === "code" ? (
              <motion.div
                key={
                  selectedPull
                    ? `pull-${selectedPull.id}`
                    : selectedBranch
                      ? `branch-${selectedBranch.name}`
                      : `code-${currentOwner}-${currentRepo}`
                }
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 sm:p-5 lg:p-8 pt-8 sm:pt-5 lg:pt-8 space-y-6 lg:space-y-8"
              >
                {/* PR/Branch Meta Header */}
                <div className="flex flex-col xl:flex-row justify-between items-start gap-5 lg:gap-8 pb-5 lg:pb-8 border-b border-white/5">
                  <div className="space-y-3 lg:space-y-4 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-brand-orange" />
                      <span className="text-[9px] uppercase tracking-[0.4em] font-medium opacity-30">
                        {isPullBranchWorkspace
                          ? "PR Branch"
                          : selectedPull
                            ? "Pull Request"
                            : selectedBranch
                              ? "Branch View"
                              : "Repository Code"}
                      </span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl lg:text-6xl font-serif italic tracking-tighter leading-[0.95] lg:leading-[0.88] break-words">
                      {selectedPull
                        ? selectedPull.title
                        : selectedBranch
                          ? selectedBranch.name
                          : `${currentOwner}/${currentRepo}`}
                    </h2>
                      <div className="flex flex-wrap gap-5 lg:gap-6 items-center pt-1">
                        {selectedPull && (
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-mono text-brand-orange/80">
                              #{selectedPull.number}
                            </span>
                            {selectedPull.draft && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 border border-white/5 opacity-40 uppercase tracking-widest rounded-sm">
                                Draft
                              </span>
                            )}
                            {selectedPull.base && selectedPull.head && (
                              <div className="flex items-center gap-2 text-[9px] font-mono opacity-30">
                                <span className="opacity-60">{selectedPull.base.ref}</span>
                                <ChevronRight className="w-2.5 h-2.5 opacity-40" />
                                <span className="text-brand-orange/60">{selectedPull.head.ref}</span>
                              </div>
                            )}
                            {authUser && (
                              <button
                                data-e2e="save-pull-toggle"
                                onClick={toggleSavedPull}
                                className={cn(
                                  "group flex items-center gap-1.5 rounded-md border px-2 py-1 text-[8px] uppercase tracking-[0.18em] transition-colors",
                                  selectedPullIsSaved
                                    ? "border-brand-orange/20 bg-brand-orange/[0.06] text-brand-orange/70"
                                    : "border-white/5 text-white/30 hover:border-white/10 hover:text-white/55",
                                )}
                              >
                                <Bookmark
                                  className={cn(
                                    "h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]",
                                    selectedPullIsSaved && "fill-current",
                                  )}
                                />
                                {selectedPullIsSaved ? "Saved" : "Save"}
                              </button>
                            )}
                            {authUser && selectedPull.state === "open" && (
                              <button
                                onClick={workPullBranchInCode}
                                disabled={!canWorkPullBranchInCode}
                                className="group flex items-center gap-1.5 rounded-md border border-white/5 px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/30 transition-colors hover:border-white/10 hover:text-white/55 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Code className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                                Edit Branch
                              </button>
                            )}
                          </div>
                        )}
                        {selectedPull && (
                          <div className="w-[1px] h-8 bg-white/10 hidden sm:block" />
                        )}

                        {selectedPull && !isPullBranchWorkspace && (
                          <>
                            <button
                              onClick={() => setActiveTab("checks")}
                              className="flex items-center gap-2 hover:bg-white/5 p-1 -m-1 transition-all rounded group"
                            >
                              {checkRuns.length === 0 ? (
                                <Circle className="h-5 w-5 text-white/15 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                              ) : checkStats.failure > 0 ? (
                                <XCircle className="h-5 w-5 text-rose-500 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                              ) : checkStats.cancelled > 0 ? (
                                <CircleSlash className="h-5 w-5 text-orange-500 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                              ) : checkStats.pending > 0 ? (
                                <RefreshCw className="h-5 w-5 animate-spin text-amber-500 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                              ) : checkStats.success === checkRuns.length - checkStats.skipped ? (
                                <CheckCircle2 className="h-5 w-5 text-emerald-500 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                              ) : (
                                <Circle className="h-5 w-5 text-white/20 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                              )}

                              <div className="flex flex-col text-left">
                                <span className="text-[8px] uppercase tracking-widest opacity-40 font-bold group-hover:opacity-60">Checks</span>
                                {checkRuns.length > 0 ? (
                                  <span className={cn(
                                    "text-[10px] font-mono",
                                    checkRuns.every(r => r.conclusion === "success" || r.conclusion === "skipped") ? "text-emerald-500" :
                                    checkRuns.some(r => r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "startup_failure") ? "text-rose-500" :
                                    checkRuns.some(r => r.conclusion === "cancelled") ? "text-orange-500" :
                                    "text-amber-500"
                                  )}>
                                    {checkStats.success}/{checkRuns.length} Passed
                                  </span>
                                ) : (
                                  <span className="h-[1em] text-[10px] font-mono text-white/10" aria-hidden="true">&nbsp;</span>
                                )}
                            </div>
                          </button>
                          <div className="w-[1px] h-8 bg-white/10 hidden sm:block" />
                        </>
                      )}

                      <div
                        className={cn(
                          "space-y-1",
                          selectedPull && !isPullBranchWorkspace && "min-w-[7rem]",
                        )}
                      >
                        <p className="text-sm font-serif italic opacity-40">
                          {isPullBranchWorkspace
                            ? `Editing ${repoFiles.length.toLocaleString()} files on ${repoTargetBranch}`
                            : selectedPull
                            ? selectedPull.created_at
                              ? new Date(
                                  selectedPull.created_at,
                                ).toLocaleDateString()
                              : "\u00A0"
                            : selectedBranch
                              ? "Comparing head against " + repoInfo?.default_branch
                              : `${repoFiles.length.toLocaleString()} files on ${repoInfo?.default_branch ?? "default branch"}`}
                        </p>
                      </div>
                    </div>
                  </div>

                  <a
                    href={
                      selectedPull
                        ? selectedPull.html_url
                        : selectedBranch
                          ? `${repoInfo?.html_url}/tree/${selectedBranch.name}`
                          : repoInfo?.html_url
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.4em] text-white/20 hover:text-white/40 transition-all"
                  >
                    Open Source <ExternalLink className="w-2.5 h-2.5 opacity-40 transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:scale-[1.04]" />
                  </a>
                </div>

                {/* Tabs */}
                <div className="sticky top-0 z-30 -mx-4 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 bg-onyx/95 backdrop-blur-md border-b border-white/5">
                  <div className="flex">
                    <button
                      onClick={() => setActiveTab("diff")}
                      className={cn(
                        "min-w-0 flex-1 px-3 sm:px-6 py-3 sm:py-3.5 text-[8px] sm:text-[9px] uppercase tracking-[0.24em] sm:tracking-[0.32em] font-medium transition-all relative overflow-hidden group text-center whitespace-nowrap",
                        activeTab === "diff"
                          ? "text-brand-orange"
                          : "text-white/20 hover:text-white/40",
                      )}
                    >
                      {viewMode === "code" ? "Code" : "Diff"}
                      {activeTab === "diff" && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute bottom-0 left-0 right-0 h-[1px] bg-brand-orange"
                        />
                      )}
                    </button>
                    {selectedPull && !isPullBranchWorkspace && (
                      <button
                        onClick={() => setActiveTab("discussion")}
                        className={cn(
                          "min-w-0 flex-1 px-3 sm:px-6 py-3 sm:py-3.5 text-[8px] sm:text-[9px] uppercase tracking-[0.24em] sm:tracking-[0.32em] font-medium transition-all relative overflow-hidden group flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap",
                          activeTab === "discussion"
                            ? "text-brand-orange"
                            : "text-white/20 hover:text-white/40",
                        )}
                        >
                        Review
                        {comments.length + reviewComments.length > 0 && (
                          <span className="text-brand-orange/60 text-[7px] sm:text-[8px] font-mono opacity-80">
                            ({comments.length + reviewComments.length})
                          </span>
                        )}
                        {activeTab === "discussion" && (
                          <motion.div
                            layoutId="activeTab"
                            className="absolute bottom-0 left-0 right-0 h-[1px] bg-brand-orange"
                          />
                        )}
                      </button>
                    )}
                    {selectedPull && !isPullBranchWorkspace && (
                      <button
                        onClick={() => setActiveTab("checks")}
                        className={cn(
                          "min-w-0 flex-1 px-3 sm:px-6 py-3 sm:py-3.5 text-[8px] sm:text-[9px] uppercase tracking-[0.24em] sm:tracking-[0.32em] font-medium transition-all relative overflow-hidden group flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap",
                          activeTab === "checks"
                            ? "text-brand-orange"
                            : "text-white/20 hover:text-white/40",
                        )}
                      >
                        Checks
                        {checkRuns.length > 0 && (
                          <span className="text-brand-orange/60 text-[7px] sm:text-[8px] font-mono opacity-80">
                            ({checkRuns.length})
                          </span>
                        )}
                        {activeTab === "checks" && (
                          <motion.div
                            layoutId="activeTab"
                            className="absolute bottom-0 left-0 right-0 h-[1px] bg-brand-orange"
                          />
                        )}
                      </button>
                    )}
                    {viewMode !== "code" && (
                      <button
                        onClick={() => setActiveTab("timeline")}
                        className={cn(
                          "min-w-0 flex-1 px-3 sm:px-6 py-3 sm:py-3.5 text-[8px] sm:text-[9px] uppercase tracking-[0.24em] sm:tracking-[0.32em] font-medium transition-all relative overflow-hidden group flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap",
                          activeTab === "timeline"
                            ? "text-brand-orange"
                            : "text-white/20 hover:text-white/40",
                        )}
                      >
                        History
                          {activeTab === "timeline" && (
                            <motion.div
                              layoutId="activeTab"
                              className="absolute bottom-0 left-0 right-0 h-[1px] bg-brand-orange"
                            />
                          )}
                        </button>
                    )}
                    </div>
                  </div>

                {/* Tab Content */}
                <div className="space-y-8 min-h-[560px]">
                  {viewMode === "code" ? (
                    <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <div className="space-y-4">
                        <div className={cn("flex items-center justify-between border-b border-white/5 pb-3", isFullscreen && "mx-auto max-w-7xl")}>
                          <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
                            {isPullBranchWorkspace ? "Branch Files" : "Repository Files"}
                          </h3>
                          <span className="text-[10px] font-mono text-white/10">
                            {repoFilesCountLabel}
                          </span>
                        </div>
                        <div className="flex max-h-[300px] flex-col overflow-y-auto rounded-xl border border-white/5 bg-onyx/40 lg:max-h-[600px] custom-scrollbar">
                          {visibleRepoFiles.map((file) => (
                            <button
                              key={file.path}
                              onClick={() => loadRepoFile(file)}
                              className={cn(
                                  "relative overflow-hidden border-b border-white/5 p-3 text-left transition-all group",
                                selectedRepoFile?.path === file.path
                                  ? "bg-brand-orange/5"
                                  : "hover:bg-white/[0.02]",
                              )}
                            >
                              {selectedRepoFile?.path === file.path && (
                                <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-brand-orange" />
                              )}
                              <div className="space-y-1.5">
                                <p
                                  className={cn(
                                    "truncate text-[10px] font-mono transition-colors",
                                    selectedRepoFile?.path === file.path
                                      ? "text-brand-orange"
                                      : "text-white/40 group-hover:text-white/60",
                                  )}
                                >
                                  {file.path}
                                </p>
                                <p className="text-[8px] uppercase tracking-[0.16em] text-white/14">
                                  {file.size != null ? `${file.size.toLocaleString()} bytes` : "repository file"}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div
                        className={cn(
                          "min-w-0 space-y-5 transition-all duration-500",
                          isFullscreen &&
                            "fixed inset-0 z-[100] bg-onyx p-5 sm:p-8 lg:p-10 overflow-y-auto custom-scrollbar",
                        )}
                      >
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <div className="flex items-center gap-2 text-white/20">
                            <Code className="w-3 h-3" />
                            <h3 className="text-[9px] font-bold uppercase tracking-[0.4em]">
                              {isPullBranchWorkspace ? "Branch Buffer" : "Repository Buffer"}
                            </h3>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-[9px] font-mono uppercase tracking-widest text-white/20 hidden sm:block">
                              {activeRepoFilePath || "No file selected"}
                            </div>
                            {authUser && (
                              <button
                                onClick={startCreateRepoFile}
                                className="text-[9px] uppercase tracking-widest opacity-20 hover:opacity-100 transition-opacity"
                              >
                                New File
                              </button>
                            )}
                            {authUser && !isRepoBufferLoading && (selectedRepoFile || isCreatingRepoFile) && repoFileContent != null && (
                              <button
                                onClick={() => {
                                  setWriteError(null);
                                  if (isEditingRepoFile) {
                                    if (isCreatingRepoFile) {
                                      setIsCreatingRepoFile(false);
                                      setRepoNewFilePath("");
                                      setSelectedRepoFile(null);
                                      setRepoFileContent(null);
                                      setRepoFileDraft("");
                                    } else {
                                      setRepoFileDraft(repoFileContent);
                                    }
                                  }
                                  setIsEditingRepoFile((current) => !current);
                                }}
                                className="text-[9px] uppercase tracking-widest opacity-20 hover:opacity-100 transition-opacity"
                              >
                                {isEditingRepoFile ? "Cancel Edit" : "Edit"}
                              </button>
                            )}
                            <button
                              onClick={() => setIsFullscreen(!isFullscreen)}
                              className="group flex items-center gap-2 text-[9px] uppercase tracking-widest text-white/20 transition-colors hover:text-white/55"
                            >
                              {isFullscreen ? (
                                <>
                                  Minimize <Minimize2 className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                                </>
                              ) : (
                                <>
                                  Maximize <Maximize2 className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className={cn("relative overflow-hidden rounded-xl border border-white/[0.035] bg-white/[0.01]", isFullscreen && "max-w-7xl mx-auto")}>
                          {isRepoBufferLoading ? (
                            <div className="min-h-36 p-14 lg:p-20" aria-busy="true" aria-label="Loading file" />
                          ) : (
                            <div
                              className={cn(
                                "overflow-auto custom-scrollbar",
                                isFullscreen
                                  ? "max-h-[calc(100vh-16rem)]"
                                  : "max-h-[600px] lg:max-h-[800px]",
                              )}
                            >
                              {isEditingRepoFile ? (
                                <textarea
                                  value={repoFileDraft}
                                  onChange={(event) => setRepoFileDraft(event.target.value)}
                                  spellCheck={false}
                                  className="min-h-[520px] w-full resize-none bg-transparent p-4 font-mono text-[10px] leading-relaxed text-white/70 outline-none custom-scrollbar sm:p-5 sm:text-xs lg:p-6"
                                />
                              ) : (
                                <pre
                                  className="code-view-highlight w-fit min-w-full whitespace-pre p-4 text-[10px] leading-relaxed text-white/60 !m-0 !bg-transparent sm:p-5 sm:text-xs lg:p-6"
                                  dangerouslySetInnerHTML={{
                                    __html:
                                      highlightedRepoFileContent ??
                                      escapeHtml(
                                        selectedRepoFile
                                          ? "File content unavailable."
                                          : "Select a repository file to inspect its content.",
                                      ),
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                        {!isRepoBufferLoading && isEditingRepoFile && (
                          <div className={cn("space-y-3 rounded-xl border border-white/[0.035] bg-white/[0.008] p-4", isFullscreen && "mx-auto max-w-7xl")}>
                            {aiDraftSummary && (
                              <div className="flex flex-col gap-2 rounded-lg border border-white/[0.04] bg-white/[0.018] px-3 py-2 text-[10px] leading-relaxed text-white/35 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex min-w-0 items-start gap-2">
                                  <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-white/16" />
                                  <span>{aiDraftSummary}</span>
                                </div>
                                {activeAiDraftId && (
                                  <button
                                    type="button"
                                    onClick={() => deleteAiDraft()}
                                    className="self-start text-[8px] font-medium uppercase tracking-[0.18em] text-white/18 transition-colors hover:text-rose-300/70"
                                  >
                                    Delete Draft
                                  </button>
                                )}
                              </div>
                            )}
                            {isCreatingRepoFile && (
                              <input
                                value={repoNewFilePath}
                                onChange={(event) => {
                                  const path = event.target.value;
                                  setRepoNewFilePath(path);
                                  setRepoCommitMessage((current) =>
                                    current === "Create file" || current.startsWith("Create ")
                                      ? `Create ${path.trim() || "file"}`
                                      : current,
                                  );
                                }}
                                placeholder="path/to/new-file.md"
                                className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-mono text-white/65 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                              />
                            )}
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_8rem]">
                              <input
                                value={repoCommitMessage}
                                onChange={(event) => setRepoCommitMessage(event.target.value)}
                                placeholder="Commit message"
                                className="min-w-0 flex-1 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-mono text-white/65 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                              />
                              <button
                                onClick={commitRepoFile}
                                disabled={committingRepoFile || !canCommitRepoFile}
                                className="rounded-lg border border-brand-orange/20 bg-brand-orange/5 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-orange/80 transition-colors hover:bg-brand-orange/10 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                {committingRepoFile ? "Committing" : "Commit"}
                              </button>
                            </div>
                            <p className="text-[9px] uppercase tracking-[0.16em] text-white/20">
                              Commits use your signed-in GitHub account. Target: {repoTargetBranch || repoInfo?.default_branch || "branch"}.
                            </p>
                            {!isPullBranchWorkspace && (
                              <div className="grid gap-3 border-t border-white/[0.04] pt-3 lg:grid-cols-[1fr_auto]">
                                <input
                                  value={repoNewBranchName}
                                  onChange={(event) => setRepoNewBranchName(event.target.value)}
                                  placeholder="new branch name"
                                  className="min-w-0 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-mono text-white/65 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                                />
                                <button
                                  onClick={createRepoBranch}
                                  disabled={creatingRepoBranch || !repoNewBranchName.trim()}
                                  className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/35 transition-colors hover:bg-white/[0.04] hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  {creatingRepoBranch ? "Creating" : "Create Branch"}
                                </button>
                              </div>
                            )}
                            {(repoTargetBranch && repoTargetBranch !== repoInfo?.default_branch) && (
                              <div className="space-y-3 border-t border-white/[0.04] pt-3">
                                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_8rem]">
                                  <input
                                    value={repoPullTitle}
                                    onChange={(event) => setRepoPullTitle(event.target.value)}
                                    placeholder="Pull request title"
                                    className="min-w-0 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-mono text-white/65 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                                  />
                                  <button
                                    onClick={repoPullUrl ? saveRepoPullMetadata : createRepoPullRequest}
                                    disabled={
                                      repoPullUrl
                                        ? savingPullMeta || !repoPullTitle.trim()
                                        : creatingRepoPull || !repoPullTitle.trim()
                                    }
                                    className="rounded-lg border border-white/8 bg-white/[0.015] px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/32 transition-colors hover:bg-white/[0.035] hover:text-white/58 disabled:cursor-not-allowed disabled:opacity-30"
                                  >
                                    {repoPullUrl ? (savingPullMeta ? "Saving" : "Save PR") : creatingRepoPull ? "Opening" : "Open PR"}
                                  </button>
                                </div>
                                <textarea
                                  value={repoPullBody}
                                  onChange={(event) => setRepoPullBody(event.target.value)}
                                  placeholder="Pull request body"
                                  className="min-h-20 w-full resize-none rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-mono leading-relaxed text-white/60 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                                />
                                {repoPullUrl && (
                                  <a
                                    href={repoPullUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group inline-flex items-center gap-2 text-[9px] uppercase tracking-[0.16em] text-white/22 transition-colors hover:text-white/50"
                                  >
                                    View pull request
                                    <ExternalLink className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:scale-[1.04]" />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : activeTab === "timeline" ? (
                    <div className="w-full min-w-0 max-w-3xl mx-auto overflow-hidden space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <div className="relative space-y-8 lg:space-y-10 py-2">
                        {getTimeline().length > 0 ? (
                          <>
                            {/* The Vertical Line */}
                            <div className="absolute left-[20px] top-0 bottom-0 w-px bg-white/5" />

                            {getTimeline().map((event, idx) => (
                              <motion.div
                                key={`${event.type}-${idx}`}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className="relative min-w-0 pl-11 sm:pl-16 group"
                              >
                                {(() => {
                                  const meta = getTimelineMeta(event);
                                  return (
                                    <>
                                      {/* Dot */}
                                      <div className={cn(
                                        "absolute left-4 w-[18px] h-[18px] rounded-full border-2 bg-onyx z-10 top-1 transition-transform group-hover:scale-125 duration-300 flex items-center justify-center",
                                        meta.dotClass,
                                      )}>
                                        {meta.icon}
                                      </div>

                                      <div className="space-y-3">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono opacity-30 uppercase tracking-widest">
                                          <span>{new Date(event.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                          <span>{new Date(event.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                          <span className={cn("text-[8px] uppercase tracking-widest", meta.labelClass)}>
                                            {meta.label}
                                          </span>
                                        </div>

                                        <div className="space-y-3 pt-0.5">
                                          {renderTimelineEventBody(event)}
                                        </div>
                                      </div>
                                    </>
                                  );
                                })()}
                              </motion.div>
                            ))}
                          </>
                        ) : (
                          <div className="rounded-xl border border-white/5 bg-white/[0.015] px-6 py-14 text-center">
                            <p className="text-[10px] uppercase tracking-[0.35em] text-white/25">
                              No history available
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : activeTab === "diff" ? (
                    <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {/* File List */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
                            Files
                          </h3>
                          <span className="text-[10px] font-mono text-white/10">
                            {files.length}
                          </span>
                        </div>
                        <div className="flex flex-col border border-white/5 bg-onyx/40 max-h-[300px] lg:max-h-[600px] overflow-y-auto custom-scrollbar rounded-xl">
                          {loadingFiles ? (
                            <div className="min-h-28" aria-busy="true" aria-label="Loading files" />
                          ) : files.length > 0 ? (
                            files.map((file) => (
                              <button
                                key={file.filename}
                                onClick={() => setSelectedFile(file)}
                                className={cn(
                                  "text-left p-4 border-b border-white/5 transition-all group relative overflow-hidden",
                                  selectedFile?.filename === file.filename
                                    ? "bg-brand-orange/5"
                                    : "hover:bg-white/[0.02]",
                                )}
                              >
                                {selectedFile?.filename === file.filename && (
                                  <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-brand-orange" />
                                )}
                                <div className="space-y-2">
                                  <p
                                    className={cn(
                                      "text-[10px] font-mono truncate transition-colors",
                                      selectedFile?.filename === file.filename
                                        ? "text-brand-orange"
                                        : "text-white/40 group-hover:text-white/60",
                                    )}
                                  >
                                    {file.filename}
                                  </p>
                                  <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-widest">
                                    <span className="text-emerald-500/60">
                                      +{file.additions}
                                    </span>
                                    <span className="text-rose-500/60">
                                      -{file.deletions}
                                    </span>
                                    <span
                                      className={cn(
                                        "rounded-md px-1.5 py-0.5 border text-[7px]",
                                        file.status === "modified"
                                          ? "border-amber-500/20 text-amber-500/60"
                                          : file.status === "added"
                                            ? "border-emerald-500/20 text-emerald-500/60"
                                            : "border-rose-500/20 text-rose-500/60",
                                      )}
                                    >
                                      {file.status}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="p-8 text-center text-[10px] uppercase tracking-[0.2em] opacity-20 italic">
                              No files changed
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Diff Editor */}
                      <div
                        className={cn(
                          "space-y-5 min-w-0 transition-all duration-500",
                          isFullscreen &&
                            "fixed inset-0 z-[100] bg-onyx p-5 sm:p-8 lg:p-10 overflow-y-auto custom-scrollbar",
                        )}
                      >
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <div className="flex items-center gap-2 text-white/20">
                            <Code className="w-3 h-3" />
                            <h3 className="text-[9px] font-bold uppercase tracking-[0.4em]">
                              Source Buffer
                            </h3>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-[9px] font-mono opacity-20 uppercase tracking-widest leading-none hidden sm:block">
                              {selectedFile?.filename || "No file selected"}
                            </div>
                            <button
                              onClick={explainPrWithAlma}
                              disabled={explainingPr || files.length === 0}
                              className="group flex items-center gap-2 text-[9px] uppercase tracking-widest text-white/20 transition-colors hover:text-white/55 disabled:opacity-30 disabled:hover:text-white/20"
                            >
                              {explainingPr ? "Reviewing…" : "Explain PR"}
                              <Sparkles className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                            </button>
                            <button
                              onClick={() => setIsFullscreen(!isFullscreen)}
                              className="group flex items-center gap-2 text-[9px] uppercase tracking-widest text-white/20 transition-colors hover:text-white/55"
                            >
                              {isFullscreen ? (
                                <>
                                  Minimize <Minimize2 className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                                </>
                              ) : (
                                <>
                                  Maximize <Maximize2 className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-[1.04]" />
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {(explainingPr || prExplanation || explainPrError) && (
                          <div className="rounded-xl border border-brand-orange/20 bg-brand-orange/[0.03] p-5 space-y-3">
                            <div className="flex items-center justify-between border-b border-white/5 pb-2">
                              <div className="flex items-center gap-2 text-brand-orange/70">
                                <Sparkles className="h-3 w-3" />
                                <h3 className="text-[9px] font-bold uppercase tracking-[0.4em]">
                                  Alma Review
                                </h3>
                              </div>
                              <button
                                onClick={() => {
                                  setPrExplanation(null);
                                  setExplainPrError(null);
                                }}
                                className="text-[9px] uppercase tracking-widest text-white/20 transition-colors hover:text-white/55"
                              >
                                Dismiss
                              </button>
                            </div>
                            {explainingPr ? (
                              <p className="text-[11px] text-white/40 italic">
                                Alma is reviewing this pull request…
                              </p>
                            ) : explainPrError ? (
                              <p className="text-[11px] text-rose-300/80">{explainPrError}</p>
                            ) : (
                              <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-white/70">
                                {prExplanation}
                              </pre>
                            )}
                          </div>
                        )}

                        <div className={cn("relative", isFullscreen && "max-w-7xl mx-auto")}>
                          <div className="relative overflow-hidden rounded-xl border border-white/[0.035] bg-white/[0.01]">
                            {loadingFiles ? (
                              <div className="min-h-36" aria-busy="true" aria-label="Loading file" />
                            ) : (
                              <div
                                className={cn(
                                  "overflow-auto custom-scrollbar w-full",
                                  isFullscreen
                                    ? "max-h-[calc(100vh-16rem)]"
                                    : "max-h-[600px] lg:max-h-[800px]",
                                )}
                              >
                                {selectedFile?.patch ? (
                                  <div className="w-fit min-w-full bg-black/20 font-mono text-[10px] sm:text-xs leading-relaxed">
                                    {diffRows.map((row, index) => (
                                      (() => {
                                        const rowId = row.newLine ? `line-${selectedFile?.filename}-${row.newLine}` : undefined;
                                        const isHighlightedRange =
                                          !!highlightedDiffTarget &&
                                          highlightedDiffTarget.path === selectedFile?.filename &&
                                          row.newLine != null &&
                                          row.newLine >= highlightedDiffTarget.startLine &&
                                          row.newLine <= highlightedDiffTarget.endLine;

                                        return (
                                      <div
                                        key={`${index}-${row.content}`}
                                        id={rowId}
                                        className={cn(
                                          "relative grid min-w-full grid-cols-[3.5rem_3.5rem_1fr] overflow-hidden transition-colors duration-500",
                                          row.kind === "added" &&
                                            "rounded-sm bg-emerald-500/[0.08] text-emerald-300/80",
                                          row.kind === "deleted" &&
                                            "rounded-sm bg-rose-500/[0.08] text-rose-300/80",
                                          row.kind === "hunk" &&
                                            "rounded-sm bg-brand-orange/[0.1] text-brand-orange/50",
                                          row.kind === "meta" &&
                                            "text-white/20",
                                          row.kind === "context" && "text-white/60",
                                          isHighlightedRange &&
                                            "rounded-sm bg-brand-orange/[0.14] text-white ring-1 ring-inset ring-brand-orange/35 shadow-[inset_3px_0_0_rgba(255,107,43,0.85)]",
                                        )}
                                      >
                                        {isHighlightedRange && (
                                          <div className="pointer-events-none absolute inset-y-1 left-0 w-1 rounded-r-full bg-brand-orange" />
                                        )}
                                        <div className="px-3 py-0.5 text-right text-white/10 select-none border-r border-white/5">
                                          {row.oldLine ?? ""}
                                        </div>
                                        <div className="px-3 py-0.5 text-right text-white/10 select-none border-r border-white/5">
                                          {row.newLine ?? ""}
                                        </div>
                                        <pre className="px-4 py-0.5 whitespace-pre overflow-x-visible">
                                          {row.content || " "}
                                        </pre>
                                      </div>
                                        );
                                      })()
                                    ))}
                                  </div>
                                ) : (
                                  <pre className="w-fit min-w-full p-4 sm:p-5 lg:p-6 text-[10px] sm:text-xs lg:text-sm font-mono leading-relaxed !bg-onyx/40 !m-0 overflow-x-visible text-white/60">
                                    {selectedFile
                                      ? "Binary file or no changes shown."
                                      : files.length > 0
                                        ? "Select a file from the manifest to view its diff."
                                        : "No code changes detected in this context."}
                                  </pre>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : activeTab === "checks" ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <section className="space-y-6">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
                              Pipeline
                            </h3>
                            <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono">
                              <span className="text-emerald-500/80">{checkStats.success} passed</span>
                              {checkStats.failure > 0 && (
                                <span className="text-rose-500/80">{checkStats.failure} failed</span>
                              )}
                              {checkStats.pending > 0 && (
                                <span className="text-amber-500/80">{checkStats.pending} running</span>
                              )}
                              {checkStats.skipped > 0 && (
                                <span className="text-white/25">{checkStats.skipped} skipped</span>
                              )}
                              {checkSummary?.merge_state_status === "dirty" && (
                                <>
                                  <span className="text-white/12">/</span>
                                  <span className="text-amber-200/55">merge conflicts</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-3">
                            {checkSummary?.merge_state_status === "dirty" && (
                              <>
                                {canResolvePullConflictsInCode && (
                                  <button
                                    onClick={resolvePullConflictsInCode}
                                    className="rounded-lg border border-amber-200/15 bg-amber-200/[0.03] px-3 py-2 text-[9px] font-medium uppercase tracking-[0.18em] text-amber-200/50 transition-colors hover:bg-amber-200/[0.06] hover:text-amber-200/75"
                                  >
                                    Resolve in Code
                                  </button>
                                )}
                                <a
                                  href={selectedPull?.html_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.24em] text-white/18 transition-colors hover:text-amber-200/70"
                                >
                                  GitHub
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </>
                            )}
                            {authUser && selectedPull?.state === "open" && (
                              <>
                                <button
                                  onClick={runPullUpdateBranch}
                                  disabled={pullActionInFlight != null}
                                  className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[9px] font-medium uppercase tracking-[0.18em] text-white/30 transition-colors hover:bg-white/[0.04] hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  {pullActionInFlight === "update" ? "Updating" : "Update Branch"}
                                </button>
                                {(["merge", "squash", "rebase"] as const).map((method) => (
                                  <button
                                    key={method}
                                    onClick={() => runPullMerge(method)}
                                    disabled={pullActionInFlight != null || checkSummary?.merge_state_status === "dirty"}
                                    className="rounded-lg border border-brand-orange/20 bg-brand-orange/5 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-brand-orange/75 transition-colors hover:bg-brand-orange/10 disabled:cursor-not-allowed disabled:opacity-30"
                                  >
                                    {pullActionInFlight === method
                                      ? method === "merge" ? "Merging" : method === "squash" ? "Squashing" : "Rebasing"
                                      : method}
                                  </button>
                                ))}
                              </>
                            )}
                            {authUser && canDeletePullHeadBranch && (
                              <button
                                onClick={deletePullHeadBranch}
                                disabled={deletingHeadBranch}
                                className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[9px] font-medium uppercase tracking-[0.18em] text-white/30 transition-colors hover:bg-white/[0.04] hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                {deletingHeadBranch ? "Deleting" : "Delete Branch"}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {checkRuns.map((run) => (
                            <button
                              key={run.id}
                              onClick={() => setSelectedRunId(run.id)}
                              className="flex items-center justify-between py-4 border-l border-white/5 pl-5 hover:border-brand-orange/30 transition-all group text-left w-full hover:bg-white/[0.01]"
                            >
                              <div className="flex items-center gap-4 min-w-0">
                                <div
                                  className={cn(
                                    "w-1 h-1 rounded-full",
                                    run.conclusion === "success" ? "bg-emerald-500/40" :
                                    (run.conclusion === "failure" || run.conclusion === "timed_out") ? "bg-rose-500/40" :
                                    "bg-white/10",
                                  )}
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 group-hover:text-white/80 transition-colors truncate">
                                    {run.name}
                                  </span>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-[9px] font-mono text-white/10">{run.conclusion || run.status}</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    </div>
                  ) : (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {selectedPull && checkRuns.length > 0 && (
                        <section className="border-b border-white/5 pb-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                              <span className="text-[9px] font-medium uppercase tracking-[0.28em] text-white/20">
                                Checks
                              </span>
                              <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono">
                                <span className="text-emerald-500/80">{checkStats.success} passed</span>
                                {checkStats.failure > 0 && (
                                  <span className="text-rose-500/80">{checkStats.failure} failed</span>
                                )}
                                {checkStats.pending > 0 && (
                                  <span className="text-amber-500/80">{checkStats.pending} running</span>
                                )}
                                {checkStats.skipped > 0 && (
                                  <span className="text-white/25">{checkStats.skipped} skipped</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => setActiveTab("checks")}
                              className="group inline-flex items-center gap-2 self-start text-[9px] font-medium uppercase tracking-[0.28em] text-white/20 transition-colors hover:text-white/55 sm:self-auto"
                            >
                              Open Checks
                              <ArrowRight className="h-3 w-3 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:translate-x-px group-hover:scale-[1.04]" />
                            </button>
                          </div>
                        </section>
                      )}

                      {/* PR Description */}
                      <section className="space-y-4">
                        {selectedPull && authUser && (
                          <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-4">
                            <div className="flex flex-wrap gap-2">
                              {selectedPullLabels.length > 0 ? (
                                selectedPullLabels.map((label) => (
                                  <span
                                    key={label.name}
                                    className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[9px] font-medium text-white/35"
                                  >
                                    {label.name}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[9px] uppercase tracking-[0.16em] text-white/16">
                                  No labels
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                setWriteError(null);
                                setIsEditingPullMeta((current) => !current);
                              }}
                              className="shrink-0 text-[9px] uppercase tracking-widest text-white/22 transition-colors hover:text-white/55"
                            >
                              {isEditingPullMeta ? "Close" : "Edit PR"}
                            </button>
                          </div>
                        )}

                        {isEditingPullMeta && selectedPull ? (
                          <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.012] p-4">
                            <input
                              value={pullTitleDraft}
                              onChange={(event) => setPullTitleDraft(event.target.value)}
                              placeholder="Pull request title"
                              className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-sm text-white/75 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                            />
                            <textarea
                              value={pullBodyDraft}
                              onChange={(event) => setPullBodyDraft(event.target.value)}
                              placeholder="Pull request body"
                              className="min-h-[180px] w-full resize-y rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-sm leading-relaxed text-white/70 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                            />
                            <input
                              value={pullLabelsDraft}
                              onChange={(event) => setPullLabelsDraft(event.target.value)}
                              placeholder="Labels, comma separated"
                              className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-mono text-white/65 outline-none transition-colors placeholder:text-white/16 focus:border-white/10"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-[9px] uppercase tracking-[0.16em] text-white/20">
                                Labels must already exist in GitHub.
                              </p>
                              <button
                                onClick={savePullMetadata}
                                disabled={savingPullMeta || !pullTitleDraft.trim()}
                                className="rounded-lg border border-brand-orange/25 bg-brand-orange/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-orange transition-colors hover:bg-brand-orange/15 disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                {savingPullMeta ? "Saving" : "Save PR"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="markdown-body prose prose-invert prose-orange max-w-none min-w-0 overflow-hidden border-l border-white/5 pl-4 sm:pl-6 py-1">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeRaw, rehypeSanitize]}
                              components={markdownComponents}
                            >
                              {selectedPull.body || "_No description provided._"}
                            </ReactMarkdown>
                          </div>
                        )}
                      </section>

                      {selectedPull && authUser && (
                        <section className="space-y-6 border-b border-white/5 pb-6">
                          <div className="space-y-4 border-b border-white/5 pb-6">
                            <div className="flex items-center justify-between gap-4">
                              <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
                                Review
                              </h3>
                              {!githubProviderToken && (
                                <span className="text-[9px] uppercase tracking-[0.18em] text-amber-300/55">
                                  Refresh sign-in to restore GitHub write token
                                </span>
                              )}
                            </div>

                            <div className="space-y-3 border-l border-white/5 pl-5 sm:pl-6">
                              <textarea
                                value={newReviewBody}
                                onChange={(event) => setNewReviewBody(event.target.value)}
                                placeholder="Add a review summary"
                              className="min-h-[96px] w-full resize-none rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/75 outline-none transition-colors placeholder:text-white/15 focus:border-brand-orange/30"
                              />
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  onClick={() => submitReview("COMMENT")}
                                  disabled={submittingReview !== null || !githubProviderToken}
                                  className="inline-flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-white/40 transition-colors hover:border-white/15 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                  {submittingReview === "COMMENT" ? "Submitting" : "Comment"}
                                </button>
                                <button
                                  onClick={() => submitReview("APPROVE")}
                                  disabled={submittingReview !== null || !githubProviderToken}
                                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/12 px-3 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-emerald-400/60 transition-colors hover:border-emerald-500/22 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                  {submittingReview === "APPROVE" ? "Submitting" : "Approve"}
                                </button>
                                <button
                                  onClick={() => submitReview("REQUEST_CHANGES")}
                                  disabled={
                                    submittingReview !== null ||
                                    !githubProviderToken ||
                                    !newReviewBody.trim()
                                  }
                                  className="inline-flex items-center gap-2 rounded-lg border border-rose-500/12 px-3 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-rose-400/60 transition-colors hover:border-rose-500/22 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                  {submittingReview === "REQUEST_CHANGES"
                                    ? "Submitting"
                                    : "Request Changes"}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-4">
                            <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
                              Reply
                            </h3>
                          </div>
                          <div className="space-y-3 border-l border-white/5 pl-5 sm:pl-6">
                            <textarea
                              value={newCommentBody}
                              onChange={(event) => setNewCommentBody(event.target.value)}
                              placeholder="Add a pull request comment"
                              className="min-h-[120px] w-full resize-none rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/75 outline-none transition-colors placeholder:text-white/15 focus:border-brand-orange/30"
                            />
                            <div className="flex items-center justify-end">
                                <button
                                  onClick={() => submitComment()}
                                disabled={
                                  submittingComment ||
                                  !githubProviderToken ||
                                  !newCommentBody.trim()
                                }
                                className="group/action inline-flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-white/40 transition-colors hover:border-brand-orange/20 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                {submittingComment ? "Publishing" : "Publish Comment"}
                                <ArrowRight className="h-3 w-3 transition-transform duration-300 ease-out group-hover/action:translate-x-0.5 group-hover/action:scale-[1.04]" />
                              </button>
                            </div>
                          </div>

                          <div className="space-y-4 border-t border-white/5 pt-6">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
                                  Inline Review Comment
                                </h3>
                                <p className="pt-2 text-[10px] text-white/22">
                                  Anchor a comment to the currently selected diff file.
                                </p>
                              </div>
                              {selectedFile && (
                                <span className="text-[9px] font-mono text-white/20">
                                  {selectedFile.filename}
                                </span>
                              )}
                            </div>
                            <div className="space-y-3 border-l border-white/5 pl-5 sm:pl-6">
                              {selectedFile ? (
                                <>
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <input
                                      type="number"
                                      min={1}
                                      value={reviewCommentLine}
                                      onChange={(event) =>
                                        setReviewCommentLine(event.target.value)
                                      }
                                      placeholder="Target line"
                                      className="quiet-number-input rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/75 outline-none transition-colors placeholder:text-white/15 focus:border-brand-orange/30"
                                    />
                                    <input
                                      type="number"
                                      min={1}
                                      value={reviewCommentStartLine}
                                      onChange={(event) =>
                                        setReviewCommentStartLine(event.target.value)
                                      }
                                      placeholder="Start line (optional range)"
                                      className="quiet-number-input rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/75 outline-none transition-colors placeholder:text-white/15 focus:border-brand-orange/30"
                                    />
                                  </div>
                                  <textarea
                                    value={newReviewCommentBody}
                                    onChange={(event) =>
                                      setNewReviewCommentBody(event.target.value)
                                    }
                                    placeholder="Add an inline review comment"
                                    className="min-h-[120px] w-full resize-none rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/75 outline-none transition-colors placeholder:text-white/15 focus:border-brand-orange/30"
                                  />
                                  {availableReviewLines.length > 0 && (
                                    <div className="text-[9px] font-mono text-white/20">
                                      Available diff lines: {availableReviewLines[0]}-{availableReviewLines[availableReviewLines.length - 1]}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-end">
                                    <button
                                      onClick={() => submitInlineReviewComment()}
                                      disabled={
                                        submittingReviewComment ||
                                        !githubProviderToken ||
                                        !selectedPull?.head?.sha ||
                                        !newReviewCommentBody.trim() ||
                                        !reviewCommentLine.trim()
                                      }
                                      className="group/action inline-flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-white/40 transition-colors hover:border-brand-orange/20 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-35"
                                    >
                                      {submittingReviewComment
                                        ? "Publishing"
                                        : "Publish Review Comment"}
                                      <ArrowRight className="h-3 w-3 transition-transform duration-300 ease-out group-hover/action:translate-x-0.5 group-hover/action:scale-[1.04]" />
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="text-[9px] uppercase tracking-[0.18em] text-white/20">
                                  Select a diff file first.
                                </div>
                              )}
                            </div>
                          </div>

                          {writeError && (
                            <div className="text-[9px] uppercase tracking-[0.18em] text-rose-400/70">
                              {writeError}
                            </div>
                          )}
                        </section>
                      )}

                      {/* General Comments */}
                      {comments.length > 0 && (
                        <section className="space-y-8">
                          <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                            <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
                              Discussion
                            </h3>
                          </div>
                          <div className="space-y-8">
                            {comments.map((comment) => (
                              <div
                                key={comment.id}
                                className="flex gap-4 sm:gap-6 group"
                              >
                                <img
                                  src={comment.user.avatar_url}
                                  alt=""
                                  className="w-8 h-8 grayscale opacity-20 shrink-0 rounded-full group-hover:opacity-40 transition-opacity"
                                />
                                <div className="space-y-4 flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] tracking-wider font-medium text-white/40 group-hover:text-white/60 transition-colors">
                                      {comment.user.login}
                                    </span>
                                    <span className="text-[9px] text-white/10 font-mono">
                                      {new Date(comment.created_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <div className="markdown-body prose prose-invert prose-sm max-w-none min-w-0 overflow-hidden text-white/50 leading-relaxed font-sans border-l border-white/5 pl-4 sm:pl-6">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      rehypePlugins={[rehypeRaw, rehypeSanitize]}
                                      components={markdownComponents}
                                    >
                                      {comment.body}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {selectedPull?.state === "open" && !loadingComments && eligibleDraftFixComments.length === 0 && (
                        <section className="space-y-3 border-t border-white/5 pt-6">
                          <div className="flex items-center gap-2 text-white/22">
                            <Sparkles className="h-2.5 w-2.5 text-white/16" />
                            <h3 className="text-[10px] font-medium uppercase tracking-[0.2em]">
                              Draft Fix
                            </h3>
                          </div>
                          <p className="max-w-xl text-[10px] leading-relaxed text-white/24">
                            Draft Fix appears when a review comment points to a file.
                          </p>
                        </section>
                      )}

                      {writeError && (
                        <div className="rounded-lg border border-rose-400/10 bg-rose-400/[0.03] px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-rose-400/70">
                          {writeError}
                        </div>
                      )}

                      {/* Review Comments */}
                      {reviewComments.length > 0 && (
                        <section className="space-y-8">
                          <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                            <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
                              Annotations
                            </h3>
                          </div>
                          <div className="space-y-8">
                            {reviewComments.map((comment) => {
                              const line = comment.line || comment.original_line;
                              const startLine = comment.start_line || comment.original_start_line;
                              const savedDraft = findSavedAiDraft(comment);

                              return (
                              <div
                                key={comment.id}
                                className="space-y-4 group"
                              >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-between">
                                  <div className="flex min-w-0 flex-[1_1_100%] items-start gap-3 sm:flex-1 sm:items-center">
                                    {getFileIcon(comment.path)}
                                    <span className="min-w-0 break-all text-[9px] font-mono leading-relaxed text-white/20 sm:truncate">
                                      {comment.path}
                                    </span>
                                    <span className="hidden shrink-0 rounded-sm border border-white/[0.04] bg-white/[0.015] px-1 py-px text-[6px] font-medium uppercase tracking-[0.16em] text-white/14 sm:inline">
                                      {getFileKindLabel(comment.path)}
                                    </span>
                                  </div>
                                  <a
                                    href={comment.html_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="pl-6 text-[9px] text-white/10 hover:text-white/40 font-mono italic leading-none transition-all sm:pl-0"
                                  >
                                    {formatReviewCommentLine(comment)}
                                  </a>
                                  {comment.path && line && (
                                    <button
                                      onClick={() => navigateToComment(comment.path!, line, startLine)}
                                      className="group/action inline-flex items-center gap-1 text-[7px] font-medium uppercase tracking-[0.18em] leading-none text-white/18 transition-colors hover:text-brand-orange"
                                    >
                                      Open in Diff
                                      <ArrowRight className="w-2.5 h-2.5 transition-transform duration-300 ease-out group-hover/action:translate-x-0.5 group-hover/action:scale-[1.04]" />
                                    </button>
                                  )}
                                  {comment.path && authUser && (
                                    <button
                                      onClick={() => draftReviewFixWithGemini(comment)}
                                      disabled={
                                        selectedPull?.state !== "open" ||
                                        draftingReviewFix !== null ||
                                        (!savedDraft && !githubProviderToken) ||
                                        !canWorkPullBranchInCode
                                      }
                                      className="group/action inline-flex items-center gap-1 text-[7px] font-medium uppercase tracking-[0.18em] leading-none text-white/18 transition-colors hover:text-white/55 disabled:cursor-not-allowed disabled:opacity-30"
                                    >
                                      {draftingReviewFix === comment.id
                                        ? "Drafting"
                                        : savedDraft
                                          ? "Open Draft"
                                          : "Draft Fix"}
                                      <Sparkles className="h-2 w-2 text-white/20 transition-transform duration-300 ease-out group-hover/action:-translate-y-px group-hover/action:scale-[1.03] group-hover/action:text-white/38" />
                                    </button>
                                  )}
                                </div>
                                <div className="flex gap-4 sm:gap-6">
                                  <img
                                    src={comment.user.avatar_url}
                                    alt=""
                                    className="w-8 h-8 grayscale opacity-20 shrink-0 rounded-full group-hover:opacity-40 transition-opacity"
                                  />
                                  <div className="space-y-4 flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] tracking-wider font-medium text-white/40 group-hover:text-white/60 transition-colors">
                                        {comment.user.login}
                                      </span>
                                      <span className="text-[9px] text-white/10 font-mono">
                                        {new Date(comment.created_at).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div className="markdown-body prose prose-invert prose-sm max-w-none min-w-0 overflow-hidden text-white/30 border-l border-white/5 pl-4 sm:pl-6 py-1">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeRaw, rehypeSanitize]}
                                        components={markdownComponents}
                                      >
                                        {comment.body}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        </section>
                      )}


                      {loadingComments && (
                        <div className="py-20 flex flex-col items-center justify-center space-y-4 opacity-20">
                          <RefreshCw className="w-8 h-8 animate-spin" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {selectedRunId && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-12 pointer-events-none"
                    >
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      className="w-full max-w-4xl max-h-[85vh] bg-panel border border-white/10 rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl flex flex-col pointer-events-auto"
                    >
                        {(() => {
                          const run = checkRuns.find(r => r.id === selectedRunId);
                          if (!run) return null;
                          const hasCurrentRunDetail = selectedRunDetail?.id === run.id;
                          const isInitialLogsLoad =
                            loadingLogs && !runLogs && runLogsFetchedForId !== run.id;

                          return (
                            <>
                              {/* Header */}
                              <div className="p-5 sm:p-6 lg:p-8 border-b border-white/5 flex items-start justify-between gap-4">
                                <div className="flex items-center gap-4 min-w-0">
                                  <div className="flex flex-col">
                                    <span className="mb-1 text-[8px] uppercase tracking-[0.2em] font-medium text-white/20">
                                      {run.type === "status" ? "Commit Status" : "Check Run"}
                                    </span>
                                    <div className="flex items-center gap-4">
                                      <h2 className="text-xs sm:text-sm font-medium uppercase tracking-[0.2em] text-white/50 break-words">
                                        {run.name}
                                      </h2>
                                      <div className={cn(
                                        "w-1 h-1 rounded-full",
                                        run.conclusion === "success" ? "bg-emerald-500/40" :
                                        (run.conclusion === "failure" || run.conclusion === "timed_out") ? "bg-rose-500/40" :
                                        "bg-white/10"
                                      )} />
                                    </div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => setSelectedRunId(null)}
                                  className="text-[9px] uppercase tracking-[0.2em] text-white/10 hover:text-white/40 transition-all font-medium"
                                >
                                  Close
                                </button>
                              </div>

                              {/* Content */}
                              <div className="flex-1 overflow-y-auto p-5 sm:p-6 lg:p-12 space-y-10 lg:space-y-16 custom-scrollbar">
                                {/* Summary Section */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-12 border-b border-white/5 pb-8 lg:pb-12">
                                  <div className="space-y-2">
                                    <span className="text-[8px] uppercase tracking-[0.2em] font-medium text-white/20">Status</span>
                                    <div className="flex items-center gap-3">
                                      <div className={cn(
                                        "w-1.5 h-1.5 rounded-full",
                                        run.status === "completed" ? "bg-emerald-500/40" : "bg-amber-500 animate-pulse"
                                      )} />
                                      <span className="text-sm font-light text-white/60">{run.status}</span>
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <span className="text-[8px] uppercase tracking-[0.2em] font-medium text-white/20">Conclusion</span>
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm font-light text-white/60 capitalize">{run.conclusion || "Pending"}</span>
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <span className="text-[8px] uppercase tracking-[0.2em] font-medium text-white/20">Execution</span>
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm font-light text-white/60">
                                        {run.started_at ? (
                                          <>
                                            {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            {run.completed_at && ` — ${new Date(run.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                                          </>
                                        ) : "—"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Visual Workflow Diagram */}
                                <div className="space-y-8">
                                  <div className="flex items-center gap-3">
                                    <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
                                      Related Checks
                                    </h3>
                                  </div>

                                  <div className="relative">
                                    <div className="flex flex-wrap items-center gap-6 lg:gap-12 py-6 lg:py-8 justify-center lg:justify-start">
                                      {loadingRunDetail && !hasCurrentRunDetail ? (
                                        <div className="flex-1 flex items-center justify-center opacity-10">
                                          <RefreshCw className="w-3 h-3 animate-spin mr-3" />
                                          <span className="text-[9px] uppercase tracking-widest font-medium">Resolving...</span>
                                        </div>
                                      ) : selectedRunDetail?.suite_runs && selectedRunDetail.suite_runs.length > 0 ? (
                                        selectedRunDetail.suite_runs.map((suiteRun, idx) => (
                                          <div key={suiteRun.id} className="flex items-center shrink-0">
                                            <button
                                              onClick={() => setSelectedRunId(suiteRun.id)}
                                              className={cn(
                                                "relative pb-2 transition-all group",
                                                suiteRun.id === run.id ? "opacity-100" : "opacity-20 hover:opacity-40"
                                              )}
                                            >
                                              <div className="flex items-center gap-3">
                                                <div className={cn(
                                                  "w-1 h-1 rounded-full",
                                                  suiteRun.conclusion === "success" ? "bg-emerald-500/60" :
                                                  suiteRun.conclusion === "failure" ? "bg-rose-500/60" :
                                                  "bg-white/30"
                                                )} />
                                                <span className="text-[10px] font-medium text-white/80 tracking-wide">{suiteRun.name}</span>
                                              </div>
                                              {suiteRun.id === run.id && (
                                                <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-brand-orange/40" />
                                              )}
                                            </button>
                                            {idx < selectedRunDetail.suite_runs.length - 1 && (
                                              <div className="ml-12 text-white/5">
                                                <ChevronRight className="w-3 h-3" />
                                              </div>
                                            )}
                                          </div>
                                        ))
                                      ) : (
                                        <div className="flex-1 flex flex-col items-center justify-center py-6 opacity-10">
                                          <span className="text-[8px] uppercase tracking-widest font-medium">
                                            Single Check
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Detailed Info */}
                                <div className="space-y-16">
                                  {/* Metadata Grid */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
                                    <div className="space-y-4">
                                      <div className="flex items-center gap-2 text-white/10">
                                        <span className="text-[8px] uppercase tracking-widest font-medium">Details</span>
                                      </div>
                                      <div className="space-y-3">
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between text-[11px]">
                                          <span className="text-white/20">ID</span>
                                          <span className="font-mono text-white/40 break-all sm:text-right">{run.id}</span>
                                        </div>
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between text-[11px]">
                                          <span className="text-white/20">Branch</span>
                                          <span className="font-mono text-white/40 break-all sm:text-right">{run.check_suite?.head_branch || "n/a"}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="space-y-4">
                                      <div className="flex items-center gap-2 text-white/10">
                                        <span className="text-[8px] uppercase tracking-widest font-medium">Timing</span>
                                      </div>
                                      <div className="space-y-3">
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between text-[11px]">
                                          <span className="text-white/20">Duration</span>
                                          <span className="font-mono text-white/40 sm:text-right">
                                            {run.started_at && run.completed_at
                                              ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 60000)}m ${Math.round(((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) % 60000) / 1000)}s`
                                              : "Ongoing"}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between text-[11px]">
                                          <span className="text-white/20">Started</span>
                                          <span className="font-mono text-white/40 sm:text-right">{run.started_at ? new Date(run.started_at).toLocaleTimeString() : "n/a"}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>


                                  {/* Annotations Section */}
                                  {selectedRunDetail?.annotations && selectedRunDetail.annotations.length > 0 && (
                                    <div className="space-y-8">
                                      <div className="flex items-center gap-3">
                                        <AlertCircle className="w-4 h-4 text-rose-500/40" />
                                        <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Annotations ({selectedRunDetail.annotations.length})</h3>
                                      </div>
                                      <div className="space-y-4">
                                        {selectedRunDetail.annotations.map((ann, idx) => (
                                          <div key={idx} className="p-4 sm:p-5 lg:p-6 bg-rose-500/[0.02] border border-rose-500/10 rounded-2xl space-y-3 min-w-0">
                                            <div className="flex items-start justify-between gap-3 min-w-0">
                                              <div className="flex items-start gap-3 min-w-0">
                                                {getFileIcon(ann.path)}
                                                <span className="text-[10px] font-mono text-white/40 underline decoration-white/5 underline-offset-4 break-all min-w-0">{ann.path}:{ann.start_line}</span>
                                                <span className="shrink-0 rounded-sm border border-white/[0.04] bg-white/[0.015] px-1 py-px text-[6px] font-medium uppercase tracking-[0.16em] text-white/14">
                                                  {getFileKindLabel(ann.path)}
                                                </span>
                                              </div>
                                            </div>
                                            <p className="text-xs text-white/80 font-mono leading-relaxed break-words overflow-hidden">{ann.message}</p>
                                            {ann.raw_details && (
                                              <pre className="p-3 sm:p-4 bg-black/40 rounded-lg text-[9px] font-mono text-white/40 overflow-x-auto whitespace-pre-wrap break-words">
                                                {ann.raw_details}
                                              </pre>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Section Toggles */}
                                  <div className="flex items-center gap-6 sm:gap-12 border-b border-white/5 pb-2 self-start">
                                    <button
                                      onClick={() => setCheckDetailTab("steps")}
                                      className={cn(
                                        "text-[10px] font-medium uppercase tracking-[0.2em] transition-all relative pb-2",
                                        checkDetailTab === "steps" ? "text-white" : "text-white/10 hover:text-white/30"
                                      )}
                                    >
                                      {checkDetailTab === "steps" && (
                                        <motion.div layoutId="tab-active" className="absolute -bottom-[2px] left-0 right-0 h-0.5 bg-brand-orange/40" />
                                      )}
                                      Steps
                                    </button>
                                    <button
                                      onClick={() => setCheckDetailTab("logs")}
                                      className={cn(
                                        "text-[10px] font-medium uppercase tracking-[0.2em] transition-all relative pb-2",
                                        checkDetailTab === "logs" ? "text-white" : "text-white/10 hover:text-white/30"
                                      )}
                                    >
                                      {checkDetailTab === "logs" && (
                                        <motion.div layoutId="tab-active" className="absolute -bottom-[2px] left-0 right-0 h-0.5 bg-brand-orange/40" />
                                      )}
                                      Raw Logs
                                    </button>
                                  </div>

                                  {checkDetailTab === "steps" ? (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">Steps</h3>
                                          {(selectedRunDetail?.status === "in_progress" || selectedRunDetail?.status === "queued") && (
                                            <div className="flex items-center gap-2 px-1.5 py-0.5 bg-amber-500/5 border border-amber-500/10 rounded-sm">
                                              <div className="w-1 h-1 bg-amber-500 rounded-full animate-pulse" />
                                              <span className="text-[7px] font-medium uppercase tracking-widest text-amber-500/60">Live</span>
                                            </div>
                                          )}
                                        </div>
                                        {selectedRunDetail?.steps && selectedRunDetail.steps.length > 0 && (
                                          <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">
                                            {selectedRunDetail.steps.length} Steps Found
                                          </span>
                                        )}
                                      </div>

                                      <div className="space-y-4 min-w-0">
                                        {errorRunDetail && (
                                          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl mb-4 flex items-center gap-3">
                                            <AlertCircle className="w-4 h-4 text-rose-500" />
                                            <span className="text-[10px] font-mono text-rose-500/80">{errorRunDetail}</span>
                                          </div>
                                        )}

                                        {/* Main Content Area */}
                                        {run.type === "status" ? (
                                          <div className="p-12 bg-white/[0.01] border border-white/5 rounded-2xl flex flex-col items-center space-y-4 opacity-10">
                                            <CircleSlash className="w-4 h-4" />
                                            <p className="text-[10px] uppercase tracking-widest font-medium">Commit Status</p>
                                          </div>
                                        ) : loadingRunDetail && !hasCurrentRunDetail ? (
                                          <div className="py-12 flex flex-col items-center justify-center space-y-4 opacity-20">
                                            <RefreshCw className="w-6 h-6 animate-spin" />
                                            <p className="text-[8px] uppercase tracking-widest font-medium">Fetching details...</p>
                                          </div>
                                        ) : (selectedRunDetail?.steps && selectedRunDetail.steps.length > 0) ? (
                                          <div className="space-y-4 sm:space-y-6">
                                            {selectedRunDetail.steps.map((step, idx) => (
                                              <div
                                                key={step.number || idx}
                                                className="group animate-in fade-in slide-in-from-left-4 duration-300 fill-mode-both"
                                                style={{ animationDelay: `${idx * 40}ms` }}
                                              >
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-1 cursor-default border-l border-white/5 pl-5 sm:pl-8 group-hover:border-white/20 transition-all min-w-0">
                                                  <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                                                    <div className={cn(
                                                      "w-1 h-1 rounded-full",
                                                      step.conclusion === "success" ? "bg-emerald-500/40" :
                                                      step.conclusion === "failure" ? "bg-rose-500/40" :
                                                      step.status === "in_progress" ? "bg-amber-500 animate-pulse" :
                                                      "bg-white/10"
                                                    )} />
                                                    <div className="space-y-0.5 min-w-0">
                                                      <span className="text-[11px] font-medium text-white/60 group-hover:text-white/80 transition-colors break-words">{step.name}</span>
                                                    </div>
                                                  </div>
                                                  <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-8">
                                                    <span className="text-[8px] font-mono text-white/10 uppercase tracking-[0.2em]">{step.conclusion || step.status}</span>
                                                    {step.started_at && step.completed_at && (
                                                      <span className="text-[9px] font-mono text-white/20 min-w-[40px] text-right">
                                                        {Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000)}s
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (selectedRunDetail?.output?.summary || selectedRunDetail?.output?.text) ? (
                                          <div className="space-y-6">
                                            <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4">
                                              <div className="flex items-center gap-2 text-white/20">
                                                <FileText className="w-3 h-3" />
                                                <span className="text-[8px] uppercase tracking-widest font-bold font-mono">Run Summary</span>
                                              </div>
                                              <div className="markdown-body prose prose-invert prose-xs max-w-none text-white/60">
                                                <ReactMarkdown>
                                                  {selectedRunDetail?.output?.summary || selectedRunDetail?.output?.text || ""}
                                                </ReactMarkdown>
                                              </div>
                                            </div>
                                            <div className="flex flex-col items-center py-6 opacity-20 space-y-2">
                                              <p className="text-[8px] uppercase tracking-widest font-bold">No step details available</p>
                                              <p className="text-[8px] text-center max-w-xs">Showing the run summary instead.</p>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="p-12 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col items-center space-y-4 opacity-20">
                                            <Activity className="w-8 h-8" />
                                            <div className="text-center space-y-1">
                                              <p className="text-[10px] uppercase tracking-widest font-bold">No step data available</p>
                                              <p className="text-[8px] max-w-xs leading-relaxed">This run does not expose step-level details yet.</p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">Logs</h3>
                                          {(selectedRunDetail?.status === "in_progress" || selectedRunDetail?.status === "queued") && (
                                            <div className="flex items-center gap-2 px-1.5 py-0.5 bg-brand-orange/5 border border-brand-orange/10 rounded-sm">
                                              <div className="w-1 h-1 bg-brand-orange rounded-full animate-pulse" />
                                              <span className="text-[7px] font-medium uppercase tracking-widest text-brand-orange/60">Streaming</span>
                                            </div>
                                          )}
                                        </div>
                                        {runLogs && (
                                          <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">
                                            {runLogs.split('\n').length.toLocaleString()} Lines
                                          </span>
                                        )}
                                      </div>

                                      <div className="bg-transparent border-l border-white/5 relative group min-w-0">
                                        <div className="flex flex-col">
                                          <div className="p-4 sm:p-6 lg:p-8 font-mono text-[11px] leading-relaxed text-white/30 overflow-x-auto whitespace-pre-wrap break-words overflow-y-auto custom-scrollbar min-h-[320px] sm:min-h-[400px] max-h-[700px] min-w-0">
                                            {runLogs ? (
                                              runLogs
                                            ) : isInitialLogsLoad ? (
                                              <div className="flex flex-col items-center justify-center py-20 space-y-4 opacity-10">
                                                <RefreshCw className="w-8 h-8 animate-spin" />
                                                <p className="text-[9px] uppercase tracking-widest font-medium text-white/5">Fetching output...</p>
                                              </div>
                                            ) : (
                                              <div className="flex flex-col items-center justify-center py-20 space-y-4 opacity-10">
                                                <Activity className="w-8 h-8" />
                                                <p className="text-[9px] uppercase tracking-widest font-medium">
                                                  {errorRunDetail ? "No data found" : "No logs available"}
                                                </p>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* External Link Footer */}
                                <div className="pt-6 border-t border-white/5">
                                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <p className="text-[10px] text-white/22 max-w-md">
                                      Open the GitHub run for logs, artifacts, and full step detail.
                                    </p>
                                    <a
                                      href={run.html_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.24em] text-white/20 transition-colors hover:text-white/45 shrink-0"
                                    >
                                      <span>Open in GitHub</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* System Stats Footer */}
                <div className="pb-12" />
              </motion.div>
            ) : (
              <div className="min-h-[400px] flex items-center justify-center p-12">
                {!loading && (
                  <div className="text-center space-y-4 max-w-sm px-12">
                    <FileCode className="w-8 h-8 text-white/16 mx-auto" />
                    <p className="text-[10px] uppercase tracking-[0.42em] text-white/18 font-medium leading-loose">
                      Select an item to inspect the diff.
                    </p>
                  </div>
                )}
              </div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Policy Acknowledgement Modal */}
      <AnimatePresence>
        {showPolicyAcknowledgement && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPolicyAcknowledgement(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              data-e2e="policy-acknowledgement"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative flex max-h-[84vh] w-full max-w-[30rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-2xl"
            >
              <div className="border-b border-white/[0.04] px-5 py-3.5 sm:px-5">
                <div className="flex items-center gap-3">
                  <img
                    src={DIFF_LOGO_URL}
                    alt=""
                    className="h-6 w-6 rounded-md object-contain"
                  />
                  <div className="space-y-1">
                    <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/38">
                      Sign in with GitHub
                    </h2>
                    <div className="text-[11px] leading-none text-white/24">
                      by Coccinella Labs Inc.
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4 sm:px-5 custom-scrollbar">
                <p className="text-[13px] leading-relaxed text-white/50">
                  DIFF uses GitHub sign-in to read pull requests and save your app state.
                </p>

                <p className="text-[11px] leading-relaxed text-white/30">
                  When you post, edit, or merge, it uses your GitHub account. Draft fixes may use Gemini.
                </p>

                <div className="flex flex-wrap gap-4 pt-0.5 text-[9px] font-medium uppercase tracking-[0.16em]">
                  <a
                    href="https://github.com/coccinella-labs/diff/blob/main/docs/legal/privacy.md"
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/28 transition-colors hover:text-white/60"
                  >
                    Privacy Policy
                  </a>
                  <a
                    href="https://github.com/coccinella-labs/diff/blob/main/docs/legal/terms.md"
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/28 transition-colors hover:text-white/60"
                  >
                    Terms of Use
                  </a>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-white/[0.04] px-5 py-3.5 sm:flex-row sm:justify-end sm:px-5">
                <button
                  onClick={() => setShowPolicyAcknowledgement(false)}
                  className="rounded-lg px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/28 transition-colors hover:bg-white/[0.03] hover:text-white/58"
                >
                  Cancel
                </button>
                <button
                  onClick={acknowledgePolicyAndSignIn}
                  className="rounded-lg border border-brand-orange/25 bg-brand-orange/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-orange transition-colors hover:bg-brand-orange/15"
                >
                  Continue with GitHub
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUpdates && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 lg:p-12">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUpdates(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              data-e2e="updates-modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative flex max-h-[84vh] w-full max-w-[32rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-2xl"
            >
              <div className="border-b border-white/[0.04] px-5 py-4 sm:px-6">
                <div className="space-y-1">
                  <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/38">
                    Updates
                  </h2>
                  <div className="text-[11px] leading-none text-white/24">
                    {releasedUpdates.length} releases
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6 custom-scrollbar">
                <section className="space-y-2">
                  <div>
                    {releasedUpdates.map((update, idx) => (
                      <div
                        key={update.version}
                        className={cn(
                          "space-y-2 py-3",
                          idx !== releasedUpdates.length - 1 && "border-b border-white/[0.04]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[10px] font-mono text-white/22">
                                {update.version}
                              </span>
                              <span className="h-1 w-1 rounded-full bg-white/10" />
                              <span className="text-[13px] font-medium leading-tight text-white/58">
                                {update.title}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-white/30">
                              {update.description}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-1">
                          {update.details.map((detail, dIdx) => (
                            <div key={dIdx} className="flex items-start gap-3">
                              <div className="mt-1.5 h-px w-1 shrink-0 bg-white/10" />
                              <span className="text-[10px] leading-relaxed text-white/36">
                                {detail}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {plannedUpdates.length > 0 && (
                  <section className="space-y-3 border-t border-white/[0.04] pt-4">
                    <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/18">
                      Planned
                    </span>
                    <div>
                      {plannedUpdates.map((update, idx) => (
                        <div
                          key={update.version}
                          className={cn(
                            "space-y-2 py-2 opacity-80",
                            idx !== plannedUpdates.length - 1 && "border-b border-white/[0.04]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2.5">
                                <span className="text-[10px] font-mono text-white/16">
                                  {update.version}
                                </span>
                              </div>
                              <span className="text-[13px] font-medium leading-tight text-white/45">
                                {update.title}
                              </span>
                              <p className="text-[11px] leading-relaxed text-white/24">
                                {update.description}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-1.5">
                            {update.details.map((detail, dIdx) => (
                              <div key={dIdx} className="flex items-start gap-3">
                                <div className="mt-1.5 h-px w-1 shrink-0 bg-white/8" />
                                <span className="text-[10px] leading-relaxed text-white/30">
                                  {detail}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              <div className="flex justify-end border-t border-white/[0.04] px-5 py-4 sm:px-6">
                <button
                  onClick={() => setShowUpdates(false)}
                  className="rounded-lg px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/28 transition-colors hover:bg-white/[0.03] hover:text-white/58"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .bg-grid-white\/\\[0\\.5\\] {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32' fill='none' stroke='rgb(255 255 255 / 0.1)'%3E%3Cpath d='M0 .5H31.5V32'/%3E%3C/svg%3E");
        }
      `,
        }}
      />
    </div>
  );
}
