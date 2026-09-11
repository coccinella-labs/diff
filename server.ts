import "dotenv/config";
import express from "express";
import path from "path";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { WebSocket, WebSocketServer } from "ws";

const isInvalidRepoFilePath = (filePath: string) =>
  filePath.startsWith("/") ||
  filePath.endsWith("/") ||
  filePath.includes("//") ||
  filePath.split("/").some((segment) => segment === "..");

const isInvalidBranchName = (name: string) =>
  name.startsWith("/") ||
  name.endsWith("/") ||
  name.includes("..") ||
  !/^[A-Za-z0-9._/-]+$/.test(name);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json({ limit: "2mb" }));
  const liveClients = new Map<WebSocket, {
    owner: string;
    repo: string;
    pullNumber: number | null;
  }>();

  // GitHub API integration
  const REPO_OWNER = process.env.GITHUB_REPO_OWNER || "coccinella-labs";
  const REPO_NAME = process.env.GITHUB_REPO_NAME || "harper";
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL?.trim();
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

  class HttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  const getGitHubToken = (req?: express.Request) => {
    const providerTokenHeader = req?.headers["x-github-provider-token"];
    const providerToken = Array.isArray(providerTokenHeader)
      ? providerTokenHeader[0]
      : providerTokenHeader;

    if (providerToken) {
      return providerToken.trim();
    }

    return process.env.GITHUB_TOKEN || null;
  };

  const getHeaders = (accept: string, req?: express.Request) => {
    const headers: any = { Accept: accept };
    const githubToken = getGitHubToken(req);
    if (githubToken) {
      headers.Authorization = `token ${githubToken}`;
    }
    return headers;
  };

  const getRepoCtx = (req: any) => ({
    owner: (req.query.owner as string) || REPO_OWNER,
    repo: (req.query.repo as string) || REPO_NAME,
  });

  if (!process.env.VERCEL) {
    app.post("/api/dev/e2e-session", async (req, res) => {
      const snapshot = req.body;
      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        typeof snapshot.access_token !== "string" ||
        typeof snapshot.refresh_token !== "string"
      ) {
        res.status(400).json({ error: "Valid Supabase session snapshot required." });
        return;
      }

      if (!supabase) {
        res.status(503).json({ error: "Supabase auth is not configured on the server." });
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(
        snapshot.access_token,
      );
      if (authError || !authData.user) {
        res.status(401).json({
          error: authError?.message || "Invalid Supabase session snapshot.",
        });
        return;
      }

      await writeFile(
        "/tmp/diff-session.json",
        `${JSON.stringify(snapshot)}\n`,
        "utf8",
      );
      res.json({ ok: true, path: "/tmp/diff-session.json" });
    });
  }

  const readBearerToken = (req: express.Request) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    return authHeader.slice("Bearer ".length).trim();
  };

  const getAuthenticatedGitHubContext = async (req: express.Request) => {
    if (!supabase) {
      throw new HttpError(
        503,
        "Supabase auth is not configured on the server.",
      );
    }

    const accessToken = readBearerToken(req);
    const providerTokenHeader = req.headers["x-github-provider-token"];
    const githubProviderToken = Array.isArray(providerTokenHeader)
      ? providerTokenHeader[0]
      : providerTokenHeader;

    if (!accessToken) {
      throw new HttpError(401, "Supabase session token required.");
    }

    if (!githubProviderToken) {
      throw new HttpError(401, "GitHub provider token required.");
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(
      accessToken,
    );

    if (authError || !authData.user) {
      throw new HttpError(401, authError?.message || "Invalid Supabase session.");
    }

    const githubUserResponse = await axios.get("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `token ${githubProviderToken}`,
      },
    });

    const githubUser = githubUserResponse.data;
    const userMetadata = authData.user.user_metadata || {};
    const allowedLogins = [
      userMetadata.user_name,
      userMetadata.preferred_username,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => value.toLowerCase());
    const providerId =
      typeof userMetadata.provider_id === "string"
        ? userMetadata.provider_id
        : null;

    if (
      allowedLogins.length > 0 &&
      !allowedLogins.includes(String(githubUser.login || "").toLowerCase())
    ) {
      throw new HttpError(
        403,
        "GitHub token does not match the signed-in Supabase user.",
      );
    }

    if (providerId && String(githubUser.id) !== providerId) {
      throw new HttpError(
        403,
        "GitHub identity does not match the signed-in Supabase user.",
      );
    }

    return {
      authUser: authData.user,
      githubProviderToken,
      githubLogin: githubUser.login,
    };
  };

  const getRepoReadHeaders = async (
    req: express.Request,
    accept: string,
  ): Promise<Record<string, string>> => {
    const accessToken = readBearerToken(req);
    const providerTokenHeader = req.headers["x-github-provider-token"];
    const providerToken = Array.isArray(providerTokenHeader)
      ? providerTokenHeader[0]
      : providerTokenHeader;

    if (providerToken?.trim()) {
      return {
        Accept: accept,
        Authorization: `token ${providerToken.trim()}`,
      };
    }

    if (accessToken) {
      throw new HttpError(401, "GitHub provider token required.");
    }

    return getHeaders(accept);
  };

  const handleError = (res: any, error: any, context: string) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const errorMsg =
      error.response?.data?.message || error.message || "Unknown error";
    const displayMsg =
      typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg);
    console.error(`GitHub API Error (${context}):`, displayMsg);
    res.status(error.response?.status || 500).json({ error: displayMsg });
  };

  const hasNoCommonAncestor = (error: any) => {
    const message = error.response?.data?.message || error.message || "";
    return typeof message === "string" && message.includes("No common ancestor");
  };

  const getActionsJobIdFromCheckRun = (checkRun: any) => {
    const candidateUrls = [
      checkRun?.details_url,
      checkRun?.html_url,
    ].filter((value): value is string => typeof value === "string");

    for (const url of candidateUrls) {
      const match = url.match(/\/job\/(\d+)(?:\D|$)/);
      if (match) {
        return match[1];
      }
    }

    if (checkRun?.app?.slug === "github-actions" && typeof checkRun?.id === "number") {
      return String(checkRun.id);
    }

    return null;
  };

  const extractGeminiJson = (value: string) => {
    const trimmed = value.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmed;
    return JSON.parse(jsonText);
  };

  const parseLiveSubscription = (message: string) => {
    const payload = JSON.parse(message);
    const owner = typeof payload.owner === "string" ? payload.owner.trim() : "";
    const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
    const rawPullNumber = Number(payload.pullNumber);

    if (payload.type !== "subscribe" || !owner || !repo) {
      return null;
    }

    return {
      owner,
      repo,
      pullNumber: Number.isFinite(rawPullNumber) && rawPullNumber > 0
        ? rawPullNumber
        : null,
    };
  };

  app.get("/api/pulls", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const state = req.query.state || "open";
      const page = req.query.page || 1;
      const perPage = req.query.per_page || 30;
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&page=${page}`;
      const readHeaders = await getRepoReadHeaders(req, "application/vnd.github.v3+json");
      const response = await axios.get(url, { headers: readHeaders }).catch(async (error) => {
        if (readHeaders.Authorization && [403, 404].includes(error.response?.status)) {
          return axios.get(url, { headers: getHeaders("application/vnd.github.v3+json") });
        }
        throw error;
      });
      res.json(response.data);
    } catch (error: any) {
      if (error.response?.status === 404) {
        try {
          const { owner, repo } = getRepoCtx(req);
          await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json"),
          });
          res.json([]);
          return;
        } catch {
          // fall through to the original 404 handling below if the repo itself is invalid
        }
      }
      handleError(res, error, "Pulls");
    }
  });

  app.post("/api/ai/explain-pr", async (req, res) => {
    try {
      const almaUrl = process.env.ALMA_URL?.trim();
      if (!almaUrl) {
        res.status(503).json({ error: "Alma is not configured." });
        return;
      }

      const diff = typeof req.body?.diff === "string" ? req.body.diff.trim() : "";
      const question =
        typeof req.body?.question === "string" ? req.body.question.trim() : "";

      if (!diff) {
        res.status(400).json({ error: "A diff is required." });
        return;
      }

      const response = await axios.post(
        `${almaUrl.replace(/\/$/, "")}/api/review-diff`,
        { diff, question: question || "Explain this pull request." },
        { headers: { "Content-Type": "application/json" } },
      );

      const review =
        typeof response.data?.review === "string" ? response.data.review.trim() : "";
      if (!review) {
        res.status(502).json({ error: "Alma returned an empty review." });
        return;
      }

      res.json({ review });
    } catch (error: any) {
      const status = error?.response?.status ?? 500;
      const message =
        error?.response?.data?.error ??
        (error instanceof Error ? error.message : "Alma review failed.");
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/ai/review-fix", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);

      const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
      if (!geminiApiKey) {
        res.status(503).json({ error: "Gemini is not configured." });
        return;
      }

      const owner = typeof req.body?.owner === "string" ? req.body.owner.trim() : "";
      const repo = typeof req.body?.repo === "string" ? req.body.repo.trim() : "";
      const rawPullNumber = Number(req.body?.pullNumber);
      const pullNumber = Number.isFinite(rawPullNumber) && rawPullNumber > 0
        ? rawPullNumber
        : null;
      const rawCommentId = Number(req.body?.commentId);
      const commentId = Number.isFinite(rawCommentId) && rawCommentId > 0
        ? rawCommentId
        : null;
      const ref = typeof req.body?.ref === "string" ? req.body.ref.trim() : "";
      const filePath = typeof req.body?.path === "string" ? req.body.path.trim() : "";

      if (!owner || !repo || !pullNumber || !commentId || !ref) {
        res.status(400).json({ error: "Repository, pull request, comment, and branch are required." });
        return;
      }

      if (!filePath) {
        res.status(400).json({ error: "File path is required." });
        return;
      }

      if (isInvalidRepoFilePath(filePath) || /[\0\r\n]/.test(ref)) {
        res.status(400).json({ error: "File path is invalid." });
        return;
      }

      const authHeaders = {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${githubProviderToken}`,
      };

      const [pullResponse, commentResponse] = await Promise.all([
        axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
          headers: authHeaders,
        }),
        axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}`, {
          headers: authHeaders,
        }),
      ]);

      const pull = pullResponse.data;
      const comment = commentResponse.data;
      const pullUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`;
      const headRepoFullName = String(pull?.head?.repo?.full_name || "").toLowerCase();
      const expectedRepoFullName = `${owner}/${repo}`.toLowerCase();
      const reviewComment = typeof comment?.body === "string" ? comment.body.trim() : "";

      if (
        headRepoFullName !== expectedRepoFullName ||
        pull?.head?.ref !== ref ||
        comment?.pull_request_url !== pullUrl ||
        comment?.path !== filePath
      ) {
        res.status(403).json({ error: "AI draft target does not match the pull request." });
        return;
      }

      if (!reviewComment) {
        res.status(400).json({ error: "Review comment is required." });
        return;
      }

      const contentResponse = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
        {
          headers: {
            Accept: "application/vnd.github.raw",
            Authorization: `token ${githubProviderToken}`,
          },
          params: { ref },
          responseType: "text",
          transformResponse: [(data) => data],
        },
      );
      const content = typeof contentResponse.data === "string"
        ? contentResponse.data
        : String(contentResponse.data ?? "");

      if (content.length > 120_000) {
        res.status(413).json({ error: "File is too large for an AI draft." });
        return;
      }

      const prompt = [
        "You are editing one repository file in response to a pull request review comment.",
        "Return JSON only with this shape: {\"content\":\"full updated file content\",\"summary\":\"short plain-language summary\"}.",
        "Always include the content property, even when the full updated file content is an empty string.",
        "Keep the change minimal and directly tied to the review comment.",
        "If the requested change is ambiguous or not safely inferable from the file, return the original content unchanged and say no safe draft was needed.",
        "Do not make unrelated cleanup or inferred maintenance changes.",
        "Do not add explanations outside JSON. Do not use markdown fences.",
        `File path: ${filePath}`,
        "Review comment:",
        reviewComment,
        "Current file content:",
        content,
      ].join("\n\n");

      const response = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiApiKey,
          },
        },
      );

      const text = response.data?.candidates?.[0]?.content?.parts
        ?.map((part: any) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();

      if (!text) {
        res.status(502).json({ error: "Gemini returned an empty draft." });
        return;
      }

      const parsed = extractGeminiJson(text);
      const parsedContent = parsed.content;
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      if (typeof parsedContent !== "string" && content.length > 0) {
        res.status(502).json({ error: "Gemini draft did not include file content." });
        return;
      }

      let nextContent = typeof parsedContent === "string" ? parsedContent : "";

      if (content.endsWith("\n") && !nextContent.endsWith("\n")) {
        nextContent += "\n";
      } else if (!content.endsWith("\n") && nextContent.endsWith("\n")) {
        nextContent = nextContent.replace(/\n+$/, "");
      }

      res.json({
        model: "gemini-2.5-flash",
        content: nextContent,
        originalContent: content,
        summary: summary || "Drafted a minimal fix.",
      });
    } catch (error: any) {
      handleError(res, error, "GeminiReviewFix");
    }
  });

  app.get("/api/pulls/:number", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
      const readHeaders = await getRepoReadHeaders(req, "application/vnd.github.v3+json");
      const response = await axios.get(url, { headers: readHeaders }).catch(async (error) => {
        if (readHeaders.Authorization && [403, 404].includes(error.response?.status)) {
          return axios.get(url, { headers: getHeaders("application/vnd.github.v3+json") });
        }
        throw error;
      });
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Pull");
    }
  });

  app.patch("/api/pulls/:number", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : undefined;
      const body = typeof req.body?.body === "string" ? req.body.body : undefined;

      if (title !== undefined && !title) {
        res.status(400).json({ error: "Pull request title is required." });
        return;
      }

      if (title === undefined && body === undefined) {
        res.status(400).json({ error: "Pull request metadata is required." });
        return;
      }

      const response = await axios.patch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
        {
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
        },
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "PullUpdate");
    }
  });

  app.put("/api/pulls/:number/labels", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const labels = Array.isArray(req.body?.labels)
        ? req.body.labels
            .filter((label: unknown): label is string => typeof label === "string")
            .map((label: string) => label.trim())
            .filter(Boolean)
        : null;

      if (!labels) {
        res.status(400).json({ error: "Labels array is required." });
        return;
      }

      const response = await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`,
        { labels },
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "PullLabelsUpdate");
    }
  });

  app.get("/api/pulls/:number/diff", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3.diff") },
      );
      res.send(response.data);
    } catch (error: any) {
      handleError(res, error, "Diff");
    }
  });

  app.get("/api/pulls/:number/files", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Files");
    }
  });

  app.get("/api/pulls/:number/comments", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Comments");
    }
  });

  app.post("/api/pulls/:number/comments", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);

      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const body =
        typeof req.body?.body === "string" ? req.body.body.trim() : "";

      if (!body) {
        res.status(400).json({ error: "Comment body is required." });
        return;
      }

      const response = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
        { body },
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.status(201).json(response.data);
    } catch (error: any) {
      handleError(res, error, "CreateComment");
    }
  });

  app.post("/api/pulls/:number/review-comments", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const body =
        typeof req.body?.body === "string" ? req.body.body.trim() : "";
      const path = typeof req.body?.path === "string" ? req.body.path.trim() : "";
      const commitId =
        typeof req.body?.commit_id === "string" ? req.body.commit_id.trim() : "";
      const line = Number(req.body?.line);
      const side =
        req.body?.side === "LEFT" || req.body?.side === "RIGHT"
          ? req.body.side
          : "RIGHT";
      const startLine =
        req.body?.start_line == null ? null : Number(req.body.start_line);
      const startSide =
        req.body?.start_side === "LEFT" || req.body?.start_side === "RIGHT"
          ? req.body.start_side
          : side;

      if (!body) {
        res.status(400).json({ error: "Review comment body is required." });
        return;
      }

      if (!path || !commitId || !Number.isFinite(line) || line <= 0) {
        res.status(400).json({
          error: "path, commit_id, and a valid line number are required.",
        });
        return;
      }

      const payload: Record<string, unknown> = {
        body,
        path,
        commit_id: commitId,
        line,
        side,
      };

      if (
        startLine != null &&
        Number.isFinite(startLine) &&
        startLine > 0 &&
        startLine !== line
      ) {
        payload.start_line = startLine;
        payload.start_side = startSide;
      }

      const response = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/comments`,
        payload,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.status(201).json(response.data);
    } catch (error: any) {
      handleError(res, error, "CreateReviewComment");
    }
  });

  app.post("/api/pulls/:number/reviews", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const body =
        typeof req.body?.body === "string" ? req.body.body.trim() : undefined;
      const event =
        req.body?.event === "COMMENT" ||
        req.body?.event === "APPROVE" ||
        req.body?.event === "REQUEST_CHANGES"
          ? req.body.event
          : "COMMENT";

      if (event === "REQUEST_CHANGES" && !body) {
        res.status(400).json({
          error: "A review body is required when requesting changes.",
        });
        return;
      }

      const response = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`,
        {
          body,
          event,
        },
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.status(201).json(response.data);
    } catch (error: any) {
      handleError(res, error, "CreateReview");
    }
  });

  app.get("/api/pulls/:number/review-comments", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/comments`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "ReviewComments");
    }
  });

  app.get("/api/pulls/:number/reviews", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Reviews");
    }
  });

  app.get("/api/pulls/:number/timeline", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Timeline");
    }
  });

  app.get("/api/pulls/:number/edits", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const headers = await getRepoReadHeaders(req, "application/vnd.github+json");
      const response = await axios.post(
        "https://api.github.com/graphql",
        {
          query: `
            query PullRequestEdits($owner: String!, $repo: String!, $number: Int!) {
              repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) {
                  userContentEdits(first: 100) {
                    nodes {
                      editedAt
                      deletedAt
                      diff
                      editor {
                        login
                        avatarUrl
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            owner,
            repo,
            number: Number(number),
          },
        },
        { headers },
      );

      res.json(
        response.data.data?.repository?.pullRequest?.userContentEdits?.nodes || [],
      );
    } catch (error: any) {
      handleError(res, error, "Edits");
    }
  });

  app.get("/api/pulls/:number/commits", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/commits`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Commits");
    }
  });

  app.get("/api/pulls/:number/checks", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const headers = await getRepoReadHeaders(req, "application/vnd.github.v3+json");

      const prResponse = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
        { headers },
      );

      const headSha = prResponse.data.head.sha;
      const mergeSha = prResponse.data.merge_commit_sha;
      const mergeable = prResponse.data.mergeable;
      const mergeStateStatus = prResponse.data.mergeable_state;

      // Fetch checks for a specific SHA
      const fetchForSha = async (sha: string) => {
        const [checks, statuses] = await Promise.all([
          axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
            { headers },
          ),
          axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/statuses?per_page=100`,
            { headers },
          )
        ]);
        return { checks: checks.data.check_runs || [], statuses: statuses.data || [] };
      };

      // Fetch both (merging them gives a more complete picture of PR status)
      const [headData, mergeData] = await Promise.all([
        fetchForSha(headSha),
        (async () => {
          if (mergeSha && mergeSha !== headSha) {
            try {
              return await fetchForSha(mergeSha);
            } catch (e) {
              return { checks: [], statuses: [] };
            }
          }
          return { checks: [], statuses: [] };
        })()
      ]);

      // Keep distinct runs, but collapse duplicate skipped reruns for the same name.
      const groupedChecks = new Map<string, any[]>();
      const uniqueStatuses = new Map();

      [...mergeData.checks, ...headData.checks].forEach((c: any) => {
        const existing = groupedChecks.get(c.name) || [];
        existing.push({ ...c, type: "check_run" });
        groupedChecks.set(c.name, existing);
      });

      const normalizedChecks = Array.from(groupedChecks.values()).flatMap((runs) => {
        if (runs.every((run) => run.conclusion === "skipped")) {
          const latestSkipped = runs
            .slice()
            .sort((a, b) => {
              const aTime = new Date(a.completed_at || a.started_at || 0).getTime();
              const bTime = new Date(b.completed_at || b.started_at || 0).getTime();
              return bTime - aTime;
            })[0];
          return latestSkipped ? [latestSkipped] : [];
        }

        return runs;
      });

      [...mergeData.statuses, ...headData.statuses].forEach((s: any) => {
        if (!uniqueStatuses.has(s.context)) {
          uniqueStatuses.set(s.context, {
            id: s.id,
            name: s.context || "Commit Status",
            status: s.state === "pending" ? "in_progress" : "completed",
            conclusion: s.state === "success" ? "success" :
                       (s.state === "failure" || s.state === "error") ? "failure" :
                       s.state === "pending" ? null : "other",
            html_url: s.target_url,
            description: s.description,
            avatar_url: s.avatar_url,
            type: "status"
          });
        }
      });

      const allChecks = [
        ...normalizedChecks,
        ...Array.from(uniqueStatuses.values())
      ];

      res.json({
        check_runs: allChecks,
        mergeable,
        merge_state_status: mergeStateStatus,
      });
    } catch (error: any) {
      handleError(res, error, "Checks");
    }
  });

  app.get("/api/branches", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const page = req.query.page || 1;
      const perPage = req.query.per_page || 30;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Branches");
    }
  });

  app.get("/api/compare/:base/:head/diff", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { base, head } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3.diff") },
      );
      res.send(response.data);
    } catch (error: any) {
      if (hasNoCommonAncestor(error)) {
        res.send("");
        return;
      }
      handleError(res, error, "CompareDiff");
    }
  });

  app.get("/api/compare/:base/:head/files", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { base, head } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data.files);
    } catch (error: any) {
      if (hasNoCommonAncestor(error)) {
        res.json([]);
        return;
      }
      handleError(res, error, "CompareFiles");
    }
  });

  app.get("/api/compare/:base/:head/commits", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { base, head } = req.params;
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data.commits || []);
    } catch (error: any) {
      if (hasNoCommonAncestor(error)) {
        res.json([]);
        return;
      }
      handleError(res, error, "CompareCommits");
    }
  });

  app.get("/api/repo", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers: await getRepoReadHeaders(req, "application/vnd.github.v3+json") },
      );
      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "Repo");
    }
  });

  app.get("/api/repo/tree", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const headers = await getRepoReadHeaders(req, "application/vnd.github.v3+json");
      const ref = typeof req.query.ref === "string" && req.query.ref.trim()
        ? req.query.ref.trim()
        : REPO_OWNER === owner && REPO_NAME === repo
          ? undefined
          : null;

      const repoInfo = ref === null
        ? await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
            headers,
          })
        : null;
      const treeRef = ref ?? repoInfo?.data?.default_branch ?? "HEAD";
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
        { headers },
      );
      res.json({
        ref: treeRef,
        truncated: response.data.truncated,
        tree: response.data.tree || [],
      });
    } catch (error: any) {
      handleError(res, error, "RepoTree");
    }
  });

  app.get("/api/repo/content", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const filePath = typeof req.query.path === "string" ? req.query.path : "";
      const ref = typeof req.query.ref === "string" ? req.query.ref : undefined;

      if (!filePath) {
        res.status(400).json({ error: "File path is required." });
        return;
      }

      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
        {
          headers: await getRepoReadHeaders(req, "application/vnd.github.raw"),
          params: ref ? { ref } : undefined,
          responseType: "text",
          transformResponse: [(data) => data],
        },
      );

      res.header("Content-Type", "text/plain; charset=utf-8");
      res.send(response.data);
    } catch (error: any) {
      handleError(res, error, "RepoContent");
    }
  });

  app.put("/api/repo/content", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const filePath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      const branch = typeof req.body?.branch === "string" ? req.body.branch.trim() : "";
      const sha = typeof req.body?.sha === "string" ? req.body.sha.trim() : "";

      if (!filePath) {
        res.status(400).json({ error: "File path is required." });
        return;
      }

      if (!message) {
        res.status(400).json({ error: "Commit message is required." });
        return;
      }

      if (!branch) {
        res.status(400).json({ error: "Target branch is required." });
        return;
      }

      if (isInvalidRepoFilePath(filePath)) {
        res.status(400).json({ error: "File path is invalid." });
        return;
      }

      const payload: {
        message: string;
        content: string;
        branch: string;
        sha?: string;
      } = {
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch,
      };

      if (sha) {
        payload.sha = sha;
      }

      const response = await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
        payload,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "RepoContentWrite");
    }
  });

  app.post("/api/repo/branch", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const from = typeof req.body?.from === "string" ? req.body.from.trim() : "";

      if (!name) {
        res.status(400).json({ error: "Branch name is required." });
        return;
      }

      if (!from) {
        res.status(400).json({ error: "Base branch is required." });
        return;
      }

      if (isInvalidBranchName(name)) {
        res.status(400).json({ error: "Branch name contains unsupported characters." });
        return;
      }

      const headers = {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${githubProviderToken}`,
      };
      const baseRef = encodeURIComponent(from).replace(/%2F/g, "/");
      const baseResponse = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseRef}`,
        { headers },
      );
      const sha = baseResponse.data?.object?.sha;

      if (typeof sha !== "string") {
        res.status(502).json({ error: "Base branch SHA was not returned by GitHub." });
        return;
      }

      const response = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/git/refs`,
        {
          ref: `refs/heads/${name}`,
          sha,
        },
        { headers },
      );

      res.status(201).json(response.data);
    } catch (error: any) {
      handleError(res, error, "RepoBranchCreate");
    }
  });

  app.post("/api/pulls/:number/update-branch", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const expectedHeadSha =
        typeof req.body?.expected_head_sha === "string" ? req.body.expected_head_sha.trim() : "";

      const response = await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/update-branch`,
        expectedHeadSha ? { expected_head_sha: expectedHeadSha } : {},
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.status(response.status).json(response.data);
    } catch (error: any) {
      handleError(res, error, "PullUpdateBranch");
    }
  });

  app.put("/api/pulls/:number/merge", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const method = typeof req.body?.method === "string" ? req.body.method.trim() : "merge";
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const message = typeof req.body?.message === "string" ? req.body.message : "";
      const sha = typeof req.body?.sha === "string" ? req.body.sha.trim() : "";

      if (!["merge", "squash", "rebase"].includes(method)) {
        res.status(400).json({ error: "Merge method must be merge, squash, or rebase." });
        return;
      }

      const response = await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`,
        {
          merge_method: method,
          ...(title ? { commit_title: title } : {}),
          ...(message ? { commit_message: message } : {}),
          ...(sha ? { sha } : {}),
        },
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.json(response.data);
    } catch (error: any) {
      handleError(res, error, "PullMerge");
    }
  });

  app.delete("/api/pulls/:number/head-branch", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const { number } = req.params;
      const headers = {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${githubProviderToken}`,
      };

      const pullResponse = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
        { headers },
      );
      const pull = pullResponse.data;
      const headRef = typeof pull?.head?.ref === "string" ? pull.head.ref : "";
      const headRepo = typeof pull?.head?.repo?.full_name === "string" ? pull.head.repo.full_name : "";

      if (!pull?.merged) {
        res.status(409).json({ error: "Pull request must be merged before deleting its branch." });
        return;
      }

      if (headRepo !== `${owner}/${repo}`) {
        res.status(409).json({ error: "Only branches in the current repository can be deleted." });
        return;
      }

      if (!headRef || isInvalidBranchName(headRef)) {
        res.status(400).json({ error: "Pull request head branch is invalid." });
        return;
      }

      await axios.delete(
        `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(headRef).replace(/%2F/g, "/")}`,
        { headers },
      );

      res.json({ deleted: true, branch: headRef });
    } catch (error: any) {
      handleError(res, error, "PullHeadBranchDelete");
    }
  });

  app.post("/api/pulls", async (req, res) => {
    try {
      const { githubProviderToken } = await getAuthenticatedGitHubContext(req);
      const { owner, repo } = getRepoCtx(req);
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const body = typeof req.body?.body === "string" ? req.body.body : "";
      const head = typeof req.body?.head === "string" ? req.body.head.trim() : "";
      const base = typeof req.body?.base === "string" ? req.body.base.trim() : "";

      if (!title) {
        res.status(400).json({ error: "Pull request title is required." });
        return;
      }

      if (!head) {
        res.status(400).json({ error: "Pull request head branch is required." });
        return;
      }

      if (!base) {
        res.status(400).json({ error: "Pull request base branch is required." });
        return;
      }

      const response = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          title,
          body,
          head,
          base,
        },
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubProviderToken}`,
          },
        },
      );

      res.status(201).json(response.data);
    } catch (error: any) {
      handleError(res, error, "PullCreate");
    }
  });

  app.get("/api/checks/:check_run_id", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { check_run_id } = req.params;
      const jsonHeaders = await getRepoReadHeaders(req, "application/vnd.github.v3+json");
      const actionsHeaders = await getRepoReadHeaders(req, "application/vnd.github+json");

      const runDetail = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/check-runs/${check_run_id}`,
        { headers: jsonHeaders },
      );
      const actionsJobId = getActionsJobIdFromCheckRun(runDetail.data);

      const [annotations, suiteRuns, actionsJob] = await Promise.all([
        axios.get(
          `https://api.github.com/repos/${owner}/${repo}/check-runs/${check_run_id}/annotations`,
          { headers: jsonHeaders },
        ).catch(() => ({ data: [] })),
        runDetail.data.check_suite?.id
          ? axios.get(
              `https://api.github.com/repos/${owner}/${repo}/check-suites/${runDetail.data.check_suite.id}/check-runs`,
              { headers: jsonHeaders }
            ).catch(() => ({ data: { check_runs: [] } }))
          : Promise.resolve({ data: { check_runs: [] } }),
        actionsJobId
          ? axios.get(
              `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${actionsJobId}`,
              { headers: actionsHeaders },
            ).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ]);

      const actionJobData = actionsJob.data;
      const mergedSteps = Array.isArray(actionJobData?.steps) && actionJobData.steps.length > 0
        ? actionJobData.steps
        : runDetail.data.steps || [];

      res.json({
        ...runDetail.data,
        steps: mergedSteps,
        ...(actionJobData
          ? {
              runner_name: actionJobData.runner_name,
              job_id: actionJobData.id,
              labels: actionJobData.labels,
              started_at: actionJobData.started_at || runDetail.data.started_at,
              completed_at: actionJobData.completed_at || runDetail.data.completed_at,
            }
          : actionsJobId
          ? {
              job_id: Number(actionsJobId),
            }
          : {}),
        annotations: annotations.data || [],
        suite_runs: suiteRuns.data.check_runs || []
      });
    } catch (error: any) {
      handleError(res, error, "CheckRunDetail");
    }
  });

  app.get("/api/checks/:job_id/logs", async (req, res) => {
    try {
      const { owner, repo } = getRepoCtx(req);
      const { job_id } = req.params;

      // Try to get logs from GitHub Actions Jobs API.
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job_id}/logs`,
        {
          headers: await getRepoReadHeaders(req, "application/vnd.github+json"),
          responseType: "text",
          maxRedirects: 5,
        },
      );

      if (typeof response.data !== "string") {
        return res.status(404).json({ error: "Logs returned in unexpected format or not available" });
      }

      res.header("Content-Type", "text/plain");
      res.send(response.data);
    } catch (error: any) {
      const status = error.response?.status || 500;
      const message = status === 404
        ? "Logs are no longer available (likely expired) or this is not a GitHub Actions run."
        : "Failed to retrieve logs from GitHub.";
      res.status(status).json({ error: message, details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if not running as a Vercel function
  if (process.env.VERCEL === undefined) {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    const wss = new WebSocketServer({ server, path: "/api/live" });
    const liveInterval = Number(process.env.DIFF_LIVE_INTERVAL_MS || 15000);

    wss.on("connection", (socket) => {
      socket.on("message", (rawMessage) => {
        try {
          const subscription = parseLiveSubscription(rawMessage.toString());
          if (!subscription) return;

          liveClients.set(socket, subscription);
          socket.send(JSON.stringify({
            type: "subscribed",
            owner: subscription.owner,
            repo: subscription.repo,
            pullNumber: subscription.pullNumber,
            intervalMs: liveInterval,
          }));
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "Invalid live subscription." }));
        }
      });

      socket.on("close", () => {
        liveClients.delete(socket);
      });
    });

    setInterval(() => {
      const now = new Date().toISOString();
      for (const [socket, subscription] of liveClients) {
        if (socket.readyState !== WebSocket.OPEN) {
          liveClients.delete(socket);
          continue;
        }

        socket.send(JSON.stringify({
          type: "refresh",
          owner: subscription.owner,
          repo: subscription.repo,
          pullNumber: subscription.pullNumber,
          at: now,
        }));
      }
    }, liveInterval).unref();
  }

  return app;
}

export default startServer();
