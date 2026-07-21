type PagesContext = {
  request: Request;
  env: {
    ASSETS: {
      fetch: (request: Request) => Promise<Response>;
    };
  };
  waitUntil: (promise: Promise<unknown>) => void;
};

type CloudflareCacheStorage = CacheStorage & {
  default: Cache;
};

const HOMEPAGE_CACHE_SECONDS = 300;

function withCacheHeader(response: Response, status: "HIT" | "MISS"): Response {
  const cachedResponse = new Response(response.body, response);
  cachedResponse.headers.set("x-vesphyr-edge-cache", status);
  cachedResponse.headers.set(
    "cache-control",
    `public, max-age=60, s-maxage=${HOMEPAGE_CACHE_SECONDS}, stale-while-revalidate=3600`,
  );
  return cachedResponse;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const url = new URL(context.request.url);
  if (url.pathname !== "/" || url.search) {
    return context.env.ASSETS.fetch(context.request);
  }

  const cache = (caches as CloudflareCacheStorage).default;
  const cacheKey = new Request(url.toString(), context.request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCacheHeader(cached, "HIT");
  }

  const response = await context.env.ASSETS.fetch(context.request);
  const responseToCache = withCacheHeader(response, "MISS");
  if (responseToCache.ok) {
    context.waitUntil(cache.put(cacheKey, responseToCache.clone()));
  }

  return responseToCache;
};

export const onRequestHead = onRequestGet;
