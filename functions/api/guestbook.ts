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
  };
};

type GuestbookEntry = {
  id: number;
  name: string;
  website: string;
  message: string;
  createdAt: string;
};

type GuestbookRow = {
  id: number;
  name: string;
  website: string | null;
  message: string;
  created_at: string;
};

type GuestbookErrorCode =
  | "BAD_REQUEST"
  | "BOT_DETECTED"
  | "METHOD_NOT_ALLOWED"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "RATE_LIMITED";

const MAX_NAME_LENGTH = 32;
const MAX_WEBSITE_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 500;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function errorResponse(
  status: number,
  code: GuestbookErrorCode,
  message: string,
): Response {
  return json(
    {
      ok: false,
      code,
      message,
    },
    status,
  );
}

function getDatabase(context: PagesContext): D1Database | null {
  return context.env.COMMENTS_DB ?? null;
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS guestbook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      website TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_guestbook_entries_created_at
      ON guestbook_entries(created_at DESC)`,
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
    const key = `gb:ip:${ip}`;
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
  const website = normalizeText(value, MAX_WEBSITE_LENGTH);
  if (!website) return "";

  try {
    const url = new URL(website);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function toEntry(row: GuestbookRow): GuestbookEntry {
  return {
    id: row.id,
    name: row.name,
    website: row.website ?? "",
    message: row.message,
    createdAt: row.created_at,
  };
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
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
    return errorResponse(
      503,
      "DATABASE_UNAVAILABLE",
      "留言数据库暂不可用。",
    );
  }

  try {
    const url = new URL(context.request.url);
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
        `SELECT id, name, website, message, created_at
         FROM guestbook_entries
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<GuestbookRow>();

    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM guestbook_entries`)
      .first<{ total: number }>();
    const total = countResult?.total ?? 0;
    const entries = (result.results ?? []).map(toEntry);

    return json({
      ok: true,
      entries,
      hasMore: offset + entries.length < total,
      total,
    });
  } catch (error) {
    console.error("guestbook:get", error);
    return errorResponse(500, "DATABASE_ERROR", "留言加载失败。");
  }
};

export const onRequestPost = async (
  context: PagesContext,
): Promise<Response> => {
  const db = getDatabase(context);
  if (!db) {
    return errorResponse(
      503,
      "DATABASE_UNAVAILABLE",
      "留言数据库暂不可用。",
    );
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
      return errorResponse(400, "BOT_DETECTED", "留言提交失败。");
    }

    const name = normalizeText(payload.name, MAX_NAME_LENGTH);
    const message = normalizeText(payload.message, MAX_MESSAGE_LENGTH);
    const website = normalizeWebsite(payload.website);

    if (name.length < 1 || message.length < 1) {
      return errorResponse(400, "BAD_REQUEST", "请填写昵称和留言内容。");
    }

    await ensureSchema(db);
    await db
      .prepare(
        `INSERT INTO guestbook_entries (name, website, message, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(name, website || null, message, new Date().toISOString())
      .run();

    const entry = await db
      .prepare(
        `SELECT id, name, website, message, created_at
         FROM guestbook_entries
         WHERE id = last_insert_rowid()`,
      )
      .first<GuestbookRow>();

    return json(
      {
        ok: true,
        entry: entry ? toEntry(entry) : null,
      },
      201,
    );
  } catch (error) {
    console.error("guestbook:post", error);
    return errorResponse(500, "DATABASE_ERROR", "留言发布失败。");
  }
};
