import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/playlist.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("playlist returns local self-hosted tracks and contacts no upstream", async () => {
  let upstreamCalled = false;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("music.163.com")) upstreamCalled = true;
    return new Response("{}", { status: 200 });
  };

  const response = await onRequestGet({
    request: new Request(
      "https://vesphyr.com/api/music/playlist?server=netease&type=playlist&id=13556055400",
    ),
  });

  assert.equal(response.status, 200);
  assert.equal(
    upstreamCalled,
    false,
    "must not contact music.163.com at runtime",
  );

  const payload = (await response.json()) as Array<{
    id: number;
    name: string;
    artist: string;
    url: string;
    duration: number;
  }>;
  assert.ok(Array.isArray(payload));
  assert.ok(payload.length >= 1, "should expose at least one local track");
  const first = payload[0];
  assert.equal(typeof first.id, "number");
  assert.equal(typeof first.name, "string");
  assert.equal(typeof first.artist, "string");
  assert.equal(first.url, `/api/music/audio?id=${first.id}`);
  assert.equal(typeof first.duration, "number");
});

test("playlist response is edge-cacheable", async () => {
  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/playlist"),
  });

  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=3600/);
});
