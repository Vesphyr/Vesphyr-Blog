import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/audio.ts";

type KvStore = Map<string, string>;

type KvMock = {
  store: KvStore;
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

function makeKvMock(initial: Record<string, string> = {}): KvMock {
  const store: KvStore = new Map(Object.entries(initial));
  return {
    store,
    get: async (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    put: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
}

function makeAudioResponse(): Response {
  return new Response("fake-audio-body", {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": "15",
    },
  });
}

function makeRedirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

function makeTextErrorResponse(status = 502): Response {
  return new Response("upstream error", {
    status,
    headers: { "content-type": "text/html" },
  });
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function collectWaitUntil() {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      promises.push(p.catch(() => {}));
    },
    settled: () => Promise.all(promises),
  };
}

test("kv audio location cache hit short-circuits the resolver chain", async () => {
  const kv = makeKvMock({
    "audio:loc:123": "https://m10.music.126.net/cached-track.mp3",
  });
  const fetchedUrls: string[] = [];

  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    fetchedUrls.push(url);
    return makeAudioResponse();
  };

  const { waitUntil, settled } = collectWaitUntil();

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=123"),
    env: { MUSIC_KV: kv },
    waitUntil,
  });

  await settled();

  assert.equal(response.status, 200);
  assert.equal(fetchedUrls.length, 1);
  assert.match(fetchedUrls[0], /music\.126\.net\/cached-track\.mp3/);
});

test("resolver success writes audio location to kv and leaves resolver healthy", async () => {
  const kv = makeKvMock();

  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;

    if (url.includes("music.163.com/song/media/outer/url")) {
      return makeTextErrorResponse();
    }
    if (url.includes("api.injahow.cn")) {
      return makeRedirectResponse("https://m10.music.126.net/resolved.mp3");
    }
    if (url.includes("music.126.net")) {
      return makeAudioResponse();
    }
    return makeTextErrorResponse();
  };

  const { waitUntil, settled } = collectWaitUntil();

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=456"),
    env: { MUSIC_KV: kv },
    waitUntil,
  });

  await settled();

  assert.equal(response.status, 200);
  assert.equal(
    kv.store.get("audio:loc:456"),
    "https://m10.music.126.net/resolved.mp3",
  );
  assert.equal(kv.store.has("resolver:unhealthy:injahow"), false);
  assert.equal(kv.store.has("resolver:unhealthy:netease-outer"), true);
});

test("all resolvers failing marks each as unhealthy and returns 502", async () => {
  const kv = makeKvMock();

  globalThis.fetch = async () => makeTextErrorResponse();

  const { waitUntil, settled } = collectWaitUntil();

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=789"),
    env: { MUSIC_KV: kv },
    waitUntil,
  });

  await settled();

  assert.equal(response.status, 502);
  assert.equal(kv.store.get("resolver:unhealthy:netease-outer"), "1");
  assert.equal(kv.store.get("resolver:unhealthy:injahow"), "1");
  assert.equal(kv.store.get("resolver:unhealthy:amarea"), "1");
  assert.equal(kv.store.get("resolver:unhealthy:nanorocky"), "1");
});

test("unhealthy resolver is skipped and remaining resolvers are tried", async () => {
  const kv = makeKvMock({
    "resolver:unhealthy:netease-outer": "1",
  });
  const fetchedUrls: string[] = [];

  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    fetchedUrls.push(url);

    if (url.includes("music.163.com/song/media/outer/url")) {
      throw new Error("unhealthy netease-outer resolver must not be called");
    }
    if (url.includes("api.injahow.cn")) {
      return makeRedirectResponse("https://m10.music.126.net/fallback.mp3");
    }
    if (url.includes("music.126.net")) {
      return makeAudioResponse();
    }
    return makeTextErrorResponse();
  };

  const { waitUntil, settled } = collectWaitUntil();

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=111"),
    env: { MUSIC_KV: kv },
    waitUntil,
  });

  await settled();

  assert.equal(response.status, 200);
  assert.ok(
    !fetchedUrls.some((u) => u.includes("music.163.com/song/media/outer/url")),
    "netease-outer resolver should have been skipped",
  );
  assert.ok(
    fetchedUrls.some((u) => u.includes("api.injahow.cn")),
    "injahow resolver should have been tried",
  );
});

test("missing or invalid song id returns 400", async () => {
  const kv = makeKvMock();

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=abc"),
    env: { MUSIC_KV: kv },
    waitUntil: () => {},
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "BAD_REQUEST");
});

test("kv unavailable degrades gracefully to resolver chain", async () => {
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("music.163.com/song/media/outer/url")) {
      return makeRedirectResponse("https://m10.music.126.net/no-kv.mp3");
    }
    if (url.includes("music.126.net")) {
      return makeAudioResponse();
    }
    return makeTextErrorResponse();
  };

  const { waitUntil, settled } = collectWaitUntil();

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=222"),
    env: {},
    waitUntil,
  });

  await settled();

  assert.equal(response.status, 200);
});
