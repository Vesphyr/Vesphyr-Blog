type KvLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type MusicEnv = {
  MUSIC_KV?: KvLike;
};

type RequestContext = {
  request: Request;
  env?: MusicEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type MusicAudioErrorCode = "BAD_REQUEST" | "UPSTREAM_ERROR";

type CloudflareCacheStorage = CacheStorage & {
  default: Cache;
};

type ResolverSource = {
  name: string;
  url: URL;
};

const AUDIO_LOCATION_CACHE_SECONDS = 60 * 60 * 24;
const RESOLVER_UNHEALTHY_TTL = 60;
const KV_AUDIO_LOCATION_TTL = 60 * 60 * 24;

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorResponse(
  status: number,
  code: MusicAudioErrorCode,
  message: string,
): Response {
  return json(
    {
      ok: false,
      code,
      message,
    },
    status,
    {
      "cache-control": "no-store",
    },
  );
}

function createNeteaseOuterUrl(songId: string): URL {
  const upstreamUrl = new URL("https://music.163.com/song/media/outer/url");
  upstreamUrl.searchParams.set("id", `${songId}.mp3`);
  return upstreamUrl;
}

function createMetingResolverUrl(baseUrl: string, songId: string): URL {
  const resolverUrl = new URL(baseUrl);
  resolverUrl.searchParams.set("server", "netease");
  resolverUrl.searchParams.set("type", "url");
  resolverUrl.searchParams.set("id", songId);
  return resolverUrl;
}

function createNeteaseEnhanceUrl(songId: string): URL {
  const upstreamUrl = new URL("https://music.163.com/song/enhance/player/url");
  upstreamUrl.searchParams.set("id", songId);
  upstreamUrl.searchParams.set("br", "320000");
  return upstreamUrl;
}

function createResolverSources(songId: string): ResolverSource[] {
  return [
    { name: "netease-enhance", url: createNeteaseEnhanceUrl(songId) },
    { name: "netease-outer", url: createNeteaseOuterUrl(songId) },
    { name: "injahow", url: createMetingResolverUrl("https://api.injahow.cn/meting/", songId) },
    { name: "amarea", url: createMetingResolverUrl("https://api.amarea.cn/meting/", songId) },
    { name: "nanorocky", url: createMetingResolverUrl("https://metingapi.nanorocky.top/", songId) },
    { name: "meting-qjdict", url: createMetingResolverUrl("https://api.qjqq.cn/api/meting/", songId) },
    { name: "meting-zj.v8", url: createMetingResolverUrl("https://api.zj.v8.lol/api/meting/", songId) },
  ];
}

function normalizeAudioLocation(location: string): string {
  if (location.startsWith("http://")) {
    return `https://${location.slice("http://".length)}`;
  }

  return location;
}

function isUsableAudioLocation(location: string): boolean {
  try {
    const audioUrl = new URL(normalizeAudioLocation(location));
    if (audioUrl.protocol !== "https:") return false;
    if (audioUrl.hostname === "music.163.com" && audioUrl.pathname === "/404") {
      return false;
    }

    return (
      audioUrl.hostname.endsWith("music.126.net") ||
      /\.(mp3|flac|m4a|aac)(?:$|[?#])/i.test(audioUrl.href)
    );
  } catch {
    return false;
  }
}

function createProxyHeaders(upstreamResponse: Response): Headers {
  const headers = new Headers();
  const passthroughHeaders = [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ];

  passthroughHeaders.forEach((headerName) => {
    const value = upstreamResponse.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  });

  if (!headers.has("content-type")) {
    headers.set("content-type", "audio/mpeg");
  }

  headers.set(
    "cache-control",
    upstreamResponse.status === 206
      ? "public, max-age=300, s-maxage=300"
      : "public, max-age=3600, s-maxage=3600",
  );

  return headers;
}

function createProxyResponse(upstreamResponse: Response, request: Request): Response {
  if (request.method === "HEAD") {
    upstreamResponse.body?.cancel();
  }

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: createProxyHeaders(upstreamResponse),
  });
}

function getAudioLocationCache(): Cache | null {
  try {
    if (typeof caches === "undefined") return null;
    return (caches as CloudflareCacheStorage).default;
  } catch {
    return null;
  }
}

function createAudioLocationCacheKey(request: Request, songId: string): Request {
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = "/api/music/audio-location";
  cacheUrl.search = "";
  cacheUrl.searchParams.set("id", songId);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

async function readCachedAudioLocation(
  request: Request,
  songId: string,
): Promise<string | null> {
  try {
    const cache = getAudioLocationCache();
    if (!cache) return null;

    const cachedResponse = await cache.match(
      createAudioLocationCacheKey(request, songId),
    );
    if (!cachedResponse?.ok) return null;

    const location = await cachedResponse.text();
    return isUsableAudioLocation(location) ? location : null;
  } catch {
    return null;
  }
}

async function writeCachedAudioLocation(
  request: Request,
  songId: string,
  location: string,
): Promise<void> {
  try {
    const cache = getAudioLocationCache();
    if (!cache || !isUsableAudioLocation(location)) return;

    await cache.put(
      createAudioLocationCacheKey(request, songId),
      new Response(normalizeAudioLocation(location), {
        headers: {
          "cache-control": `public, max-age=${AUDIO_LOCATION_CACHE_SECONDS}, s-maxage=${AUDIO_LOCATION_CACHE_SECONDS}`,
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    );
  } catch {
    // Cache API failures should never block playback.
  }
}

function getKv(env?: MusicEnv): KvLike | null {
  try {
    return env?.MUSIC_KV ?? null;
  } catch {
    return null;
  }
}

function getKvAudioLocationKey(songId: string): string {
  return `audio:loc:${songId}`;
}

function getKvResolverUnhealthyKey(name: string): string {
  return `resolver:unhealthy:${name}`;
}

async function readKvAudioLocation(
  env: MusicEnv | undefined,
  songId: string,
): Promise<string | null> {
  try {
    const kv = getKv(env);
    if (!kv) return null;

    const location = await kv.get(getKvAudioLocationKey(songId));
    if (!location) return null;
    return isUsableAudioLocation(location) ? location : null;
  } catch {
    return null;
  }
}

async function writeKvAudioLocation(
  env: MusicEnv | undefined,
  songId: string,
  location: string,
): Promise<void> {
  try {
    const kv = getKv(env);
    if (!kv || !isUsableAudioLocation(location)) return;

    await kv.put(getKvAudioLocationKey(songId), normalizeAudioLocation(location), {
      expirationTtl: KV_AUDIO_LOCATION_TTL,
    });
  } catch {
    // KV write failures should never block playback.
  }
}

async function isResolverHealthy(
  env: MusicEnv | undefined,
  name: string,
): Promise<boolean> {
  try {
    const kv = getKv(env);
    if (!kv) return true;

    const marker = await kv.get(getKvResolverUnhealthyKey(name));
    return marker === null;
  } catch {
    return true;
  }
}

async function markResolverUnhealthy(
  env: MusicEnv | undefined,
  name: string,
): Promise<void> {
  try {
    const kv = getKv(env);
    if (!kv) return;

    await kv.put(getKvResolverUnhealthyKey(name), "1", {
      expirationTtl: RESOLVER_UNHEALTHY_TTL,
    });
  } catch {
    // Health tracking failures should never block playback.
  }
}

async function clearResolverUnhealthy(
  env: MusicEnv | undefined,
  name: string,
): Promise<void> {
  try {
    const kv = getKv(env);
    if (!kv) return;

    await kv.delete(getKvResolverUnhealthyKey(name));
  } catch {
    // Health tracking failures should never block playback.
  }
}

function isAudioResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return (
    contentType.startsWith("audio/") ||
    contentType.includes("application/octet-stream")
  );
}

async function fetchAudioLocation(
  location: string,
  request: Request,
  upstreamHeaders: Headers,
): Promise<Response | null> {
  const audioLocation = normalizeAudioLocation(location);
  if (!isUsableAudioLocation(audioLocation)) {
    return null;
  }

  const audioResponse = await fetch(audioLocation, {
    method: request.method === "HEAD" ? "GET" : request.method,
    headers: upstreamHeaders,
    redirect: "follow",
  });

  if (!isAudioResponse(audioResponse)) {
    audioResponse.body?.cancel();
    return null;
  }

  return createProxyResponse(audioResponse, request);
}

async function resolveAudioResponse(
  resolverUrl: URL,
  request: Request,
  upstreamHeaders: Headers,
  onResolvedLocation?: (location: string) => void,
): Promise<Response | null> {
  const upstreamResponse = await fetch(resolverUrl, {
    method: request.method === "HEAD" ? "GET" : request.method,
    headers: upstreamHeaders,
    redirect: "manual",
  });
  const redirectLocation = upstreamResponse.headers.get("location");

  if (redirectLocation && isUsableAudioLocation(redirectLocation)) {
    const audioResponse = await fetchAudioLocation(
      redirectLocation,
      request,
      upstreamHeaders,
    );
    if (audioResponse) {
      onResolvedLocation?.(redirectLocation);
      return audioResponse;
    }
  }

  if (isAudioResponse(upstreamResponse)) {
    return createProxyResponse(upstreamResponse, request);
  }

  if (upstreamResponse.ok) {
    const responseText = await upstreamResponse.text();
    const trimmedText = responseText.trim();
    if (isUsableAudioLocation(trimmedText)) {
      const audioResponse = await fetchAudioLocation(
        trimmedText,
        request,
        upstreamHeaders,
      );
      if (audioResponse) {
        onResolvedLocation?.(trimmedText);
      }
      return audioResponse;
    }
  }

  return null;
}

async function resolveNeteaseEnhance(
  resolverUrl: URL,
  request: Request,
  upstreamHeaders: Headers,
  onResolvedLocation?: (location: string) => void,
): Promise<Response | null> {
  const response = await fetch(resolverUrl, {
    method: "GET",
    headers: upstreamHeaders,
  });
  if (!response.ok) return null;

  try {
    const payload = (await response.json()) as {
      code?: number;
      data?: Array<{ url?: string | null; br?: number; size?: number }>;
    };
    const songData = payload.data?.[0];
    if (!songData?.url) return null;

    const location = songData.url;
    if (!isUsableAudioLocation(location)) return null;

    const audioResponse = await fetchAudioLocation(
      location,
      request,
      upstreamHeaders,
    );
    if (audioResponse) {
      onResolvedLocation?.(location);
    }
    return audioResponse;
  } catch {
    return null;
  }
}

async function selectHealthySources(
  env: MusicEnv | undefined,
  sources: ResolverSource[],
): Promise<ResolverSource[]> {
  const healthy: ResolverSource[] = [];
  for (const source of sources) {
    if (await isResolverHealthy(env, source.name)) {
      healthy.push(source);
    }
  }
  return healthy.length > 0 ? healthy : sources;
}

async function handleAudioRequest(context: RequestContext): Promise<Response> {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const songId = url.searchParams.get("id")?.trim() ?? "";

  if (!/^\d+$/.test(songId)) {
    return errorResponse(400, "BAD_REQUEST", "Missing or invalid song id.");
  }

  const upstreamHeaders = new Headers({
    accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
    referer: "https://music.163.com/",
    "user-agent":
      request.headers.get("user-agent") ||
      "Mozilla/5.0 (compatible; VesphyrMusicResolver/1.0)",
  });
  const range = request.headers.get("range");

  if (range) {
    upstreamHeaders.set("range", range);
  }

  const scheduleCacheWrites = (location: string) => {
    waitUntil?.(
      Promise.all([
        writeCachedAudioLocation(request, songId, location),
        writeKvAudioLocation(env, songId, location),
      ]),
    );
  };

  try {
    const staticUrl = new URL(`/music/${songId}.mp3`, request.url);
    const staticResponse = await fetch(staticUrl, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: range ? { range } : {},
    });
    if (staticResponse.ok || staticResponse.status === 206) {
      const headers = new Headers();
      headers.set("content-type", "audio/mpeg");
      headers.set("cache-control", "public, max-age=86400, s-maxage=86400");
      headers.set("accept-ranges", "bytes");
      const ct = staticResponse.headers.get("content-type");
      if (ct) headers.set("content-type", ct);
      const cl = staticResponse.headers.get("content-length");
      if (cl) headers.set("content-length", cl);
      const cr = staticResponse.headers.get("content-range");
      if (cr) headers.set("content-range", cr);
      const etag = staticResponse.headers.get("etag");
      if (etag) headers.set("etag", etag);
      return new Response(
        request.method === "HEAD" ? null : staticResponse.body,
        { status: staticResponse.status, headers },
      );
    }
    staticResponse.body?.cancel();

    const cachedLocation = await readCachedAudioLocation(request, songId);
    if (cachedLocation) {
      const cachedAudioResponse = await fetchAudioLocation(
        cachedLocation,
        request,
        upstreamHeaders,
      );
      if (cachedAudioResponse) {
        return cachedAudioResponse;
      }
    }

    const kvLocation = await readKvAudioLocation(env, songId);
    if (kvLocation) {
      const kvAudioResponse = await fetchAudioLocation(
        kvLocation,
        request,
        upstreamHeaders,
      );
      if (kvAudioResponse) {
        waitUntil?.(writeCachedAudioLocation(request, songId, kvLocation));
        return kvAudioResponse;
      }
    }

    const allSources = createResolverSources(songId);
    const sourcesToTry = await selectHealthySources(env, allSources);

    for (const source of sourcesToTry) {
      const onResolved = (location: string) => {
        scheduleCacheWrites(location);
        waitUntil?.(clearResolverUnhealthy(env, source.name));
      };

      const resolvedResponse = source.name === "netease-enhance"
        ? await resolveNeteaseEnhance(source.url, request, upstreamHeaders, onResolved)
        : await resolveAudioResponse(source.url, request, upstreamHeaders, onResolved);

      if (resolvedResponse) {
        return resolvedResponse;
      }

      waitUntil?.(markResolverUnhealthy(env, source.name));
    }

    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "No music resolver returned a playable audio URL.",
    );
  } catch (error) {
    console.error("music:audio", error);
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to resolve audio from music upstream.",
    );
  }
}

type PagesFunctionContext = {
  request: Request;
  env?: MusicEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export const onRequestGet = (context: PagesFunctionContext) =>
  handleAudioRequest(context);

export const onRequestHead = (context: PagesFunctionContext) =>
  handleAudioRequest(context);
