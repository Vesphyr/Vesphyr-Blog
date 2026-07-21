import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/playlist.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("music playlist api maps a netease playlist into player tracks", async () => {
  const requestedUrls: string[] = [];
  let requestHeaders: Headers | undefined;

  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const requestedUrl =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    requestedUrls.push(requestedUrl);
    requestHeaders = new Headers(init?.headers);

    if (requestedUrl.startsWith("https://music.163.com/api/song/detail")) {
      return new Response(
        JSON.stringify({
          songs: [
            {
              id: 29722369,
              name: "Missing Song",
              ar: [{ name: "Missing Artist" }],
              al: {
                picUrl: "http://p1.music.126.net/missing.jpg",
              },
              dt: 232381,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        playlist: {
          tracks: [
            {
              id: 1417453801,
              name: "Test Song",
              artists: [{ name: "Test Artist" }],
              album: {
                picUrl: "http://p1.music.126.net/example.jpg",
              },
              duration: 82383,
            },
          ],
          trackIds: [{ id: 1417453801 }, { id: 29722369 }],
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };

  const response = await onRequestGet({
    request: new Request(
      "https://vesphyr.com/api/music/playlist?server=netease&type=playlist&id=13556055400",
    ),
  });

  assert.equal(response.status, 200);
  assert.match(
    requestedUrls[0],
    /^https:\/\/music\.163\.com\/api\/v6\/playlist\/detail\?id=13556055400$/,
  );
  assert.match(
    requestedUrls[1],
    /^https:\/\/music\.163\.com\/api\/song\/detail\?ids=%5B29722369%5D$/,
  );
  assert.equal(requestHeaders?.get("referer"), "https://music.163.com/");
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=300/);

  const payload = await response.json();
  assert.deepEqual(payload, [
    {
      id: 1417453801,
      name: "Test Song",
      artist: "Test Artist",
      author: "Test Artist",
      pic: "https://p1.music.126.net/example.jpg",
      url: "/api/music/audio?id=1417453801",
      duration: 82383,
    },
    {
      id: 29722369,
      name: "Missing Song",
      artist: "Missing Artist",
      author: "Missing Artist",
      pic: "https://p1.music.126.net/missing.jpg",
      url: "/api/music/audio?id=29722369",
      duration: 232381,
    },
  ]);
});

test("music playlist api rejects unsupported sources", async () => {
  const response = await onRequestGet({
    request: new Request(
      "https://vesphyr.com/api/music/playlist?server=tencent&type=playlist&id=123",
    ),
  });

  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "UNSUPPORTED_SOURCE");
});

test("music playlist api surfaces upstream failures", async () => {
  globalThis.fetch = async () =>
    new Response("upstream error", {
      status: 503,
    });

  const response = await onRequestGet({
    request: new Request(
      "https://vesphyr.com/api/music/playlist?server=netease&type=playlist&id=123",
    ),
  });

  assert.equal(response.status, 502);

  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "UPSTREAM_ERROR");
});
