type D1Result<T = unknown> = {
  results?: T[];
  success: boolean;
  error?: string;
};

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
  run: () => Promise<D1Result>;
  all: <T = unknown>() => Promise<D1Result<T>>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

type KvLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

type PagesContext = {
  request: Request;
  env: {
    COMMENTS_DB?: D1Database;
    MUSIC_KV?: KvLike;
    GUESTBOOK_ADMIN_TOKEN?: string;
  };
};

type CommentRow = {
  id: number;
  post_slug: string;
  author_name: string;
  author_url: string | null;
  content: string;
  created_at: number;
};

type Comment = {
  id: number;
  authorName: string;
  authorUrl: string;
  content: string;
  createdAt: number;
};

type CommentErrorCode =
  | "BAD_REQUEST"
  | "BOT_DETECTED"
  | "METHOD_NOT_ALLOWED"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

const MAX_NAME_LENGTH = 32;
const MAX_URL_LENGTH = 160;
const MAX_CONTENT_LENGTH = 1000;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

function json(
  data: unknown,
  status = 200,
  options?: { headers?: HeadersInit; cacheControl?: string },
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": options?.cacheControl ?? "no-store",
      ...options?.headers,
    },
  });
}

function errorResponse(
  status: number,
  code: CommentErrorCode,
  message: string,
): Response {
  return json({ ok: false, code, message }, status);
}

function getDatabase(context: PagesContext): D1Database | null {
  return context.env.COMMENTS_DB ?? null;
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_slug TEXT NOT NULL,
      post_url TEXT NOT NULL,
      post_title TEXT NOT NULL DEFAULT '',
      parent_id INTEGER,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL DEFAULT '',
      author_url TEXT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_comments_post_created
      ON comments (post_slug, created_at)`,
    )
    .run();
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function checkRateLimit(
  kv: KvLike | undefined,
  ip: string,
): Promise<boolean> {
  if (!kv) return true;
  try {
    const key = `cm:ip:${ip}`;
    const current = await kv.get(key);
    const count = current ? parseInt(current, 10) || 0 : 0;
    if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
    await kv.put(key, String(count + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    });
    return true;
  } catch {
    return true;
  }
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function normalizeWebsite(value: unknown): string {
  const website = normalizeText(value, MAX_URL_LENGTH);
  if (!website) return "";
  try {
    const url = new URL(website);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    authorName: row.author_name,
    authorUrl: row.author_url ?? "",
    content: row.content,
    createdAt: row.created_at,
  };
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const url = new URL(request.url);
  if (origin === url.origin) return true;
  const normalizedOrigin = origin.replace(/^http:/, "https:");
  const normalizedUrlOrigin = url.origin.replace(/^http:/, "https:");
  return normalizedOrigin === normalizedUrlOrigin;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  const payload = await request.json();
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const db = getDatabase(context);
  if (!db) {
    return errorResponse(503, "DATABASE_UNAVAILABLE", "评论数据库暂不可用。");
  }

  try {
    const url = new URL(context.request.url);
    const postSlug = (url.searchParams.get("post_slug") ?? "").trim();
    if (!postSlug) {
      return errorResponse(400, "BAD_REQUEST", "缺少文章标识。");
    }

    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      50,
    );
    const offset = Math.max(
      parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
      0,
    );

    await ensureSchema(db);
    const result = await db
      .prepare(
        `SELECT id, post_slug, author_name, author_url, content, created_at
         FROM comments
         WHERE post_slug = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(postSlug, limit, offset)
      .all<CommentRow>();

    const countResult = await db
      .prepare(
        `SELECT COUNT(*) as total FROM comments WHERE post_slug = ?`,
      )
      .bind(postSlug)
      .first<{ total: number }>();
    const total = countResult?.total ?? 0;
    const comments = (result.results ?? []).map(toComment);

    return json(
      { ok: true, comments, hasMore: offset + comments.length < total, total },
      200,
      { cacheControl: "public, max-age=20, s-maxage=60" },
    );
  } catch (error) {
    console.error("comments:get", error);
    return errorResponse(500, "DATABASE_ERROR", "评论加载失败。");
  }
};

export const onRequestPost = async (
  context: PagesContext,
): Promise<Response> => {
  const db = getDatabase(context);
  if (!db) {
    return errorResponse(503, "DATABASE_UNAVAILABLE", "评论数据库暂不可用。");
  }

  const allowed = await checkRateLimit(
    context.env.MUSIC_KV,
    getClientIp(context.request),
  );
  if (!allowed) {
    return errorResponse(429, "RATE_LIMITED", "提交过于频繁，请稍后再试。");
  }

  try {
    if (!isSameOriginRequest(context.request)) {
      return errorResponse(400, "BAD_REQUEST", "Invalid request origin.");
    }

    const payload = await readJson(context.request);
    const honeypot = normalizeText(payload.company, 80);
    if (honeypot) {
      return errorResponse(400, "BOT_DETECTED", "评论提交失败。");
    }

    const name = normalizeText(payload.name, MAX_NAME_LENGTH);
    const content = normalizeText(payload.content, MAX_CONTENT_LENGTH);
    const authorUrl = normalizeWebsite(payload.website);
    const postSlug = normalizeText(payload.post_slug, 256);
    const postUrl = normalizeText(payload.post_url, 512);
    const postTitle = normalizeText(payload.post_title, 256);

    if (name.length < 1 || content.length < 1) {
      return errorResponse(400, "BAD_REQUEST", "请填写昵称和评论内容。");
    }
    if (!postSlug) {
      return errorResponse(400, "BAD_REQUEST", "缺少文章标识。");
    }

    const now = Math.floor(Date.now() / 1000);
    await ensureSchema(db);
    await db
      .prepare(
        `INSERT INTO comments (post_slug, post_url, post_title, author_name, author_email, author_url, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`,
      )
      .bind(postSlug, postUrl, postTitle, name, authorUrl || null, content, now, now)
      .run();

    const row = await db
      .prepare(
        `SELECT id, post_slug, author_name, author_url, content, created_at
         FROM comments
         WHERE id = last_insert_rowid()`,
      )
      .first<CommentRow>();

    return json(
      { ok: true, comment: row ? toComment(row) : null },
      201,
    );
  } catch (error) {
    console.error("comments:post", error);
    return errorResponse(500, "DATABASE_ERROR", "评论发布失败。");
  }
};

export const onRequestDelete = async (
  context: PagesContext,
): Promise<Response> => {
  const db = getDatabase(context);
  if (!db) {
    return errorResponse(503, "DATABASE_UNAVAILABLE", "评论数据库暂不可用。");
  }

  const adminToken = context.env.GUESTBOOK_ADMIN_TOKEN;
  if (!adminToken) {
    return errorResponse(503, "DATABASE_UNAVAILABLE", "管理员删除功能未配置。");
  }

  const provided = context.request.headers.get("x-admin-token");
  if (!provided || provided !== adminToken) {
    return errorResponse(401, "UNAUTHORIZED", "无权操作。");
  }

  try {
    const url = new URL(context.request.url);
    const id = parseInt(url.searchParams.get("id") ?? "0", 10);
    if (!Number.isFinite(id) || id <= 0) {
      return errorResponse(400, "BAD_REQUEST", "缺少有效的评论 ID。");
    }

    await ensureSchema(db);
    const result = await db
      .prepare(`DELETE FROM comments WHERE id = ?`)
      .bind(id)
      .run();

    const affected =
      (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    return json({ ok: true, id, affected });
  } catch (error) {
    console.error("comments:delete", error);
    return errorResponse(500, "DATABASE_ERROR", "评论删除失败。");
  }
};
