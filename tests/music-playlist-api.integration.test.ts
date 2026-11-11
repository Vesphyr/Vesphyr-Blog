import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/playlist.ts";

test("music playlist api returns local tracks without contacting upstream", async () => {
  const response = await onRequestGet({
    request: new Request("https://dionys.com/api/music/playlist"),
  });

  assert.equal(response.status, 200);

  const payload = (await response.json()) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(payload) && payload.length > 0);

  for (const song of payload) {
    assert.equal(typeof song.id, "number");
    assert.equal(typeof song.name, "string");
    assert.equal(typeof song.artist, "string");
    assert.equal(typeof song.url, "string");
    // Audio is served straight from the self-hosted static file, so the browser
    // gets real Range support (206) instead of a proxied 200 with the whole audio file.
    // The playlist stamps a ?v=<etag> param onto every URL to bust stale caches.
    assert.match(
      String(song.url),
      /^\/music\/\d+\.m4a\?v=[0-9a-f]{8}$/,
      `url ${song.url} should point at the local static m4a with a version param`,
    );
  }

  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=\d+/);
});

test("music playlist api returns 304 when the etag matches", async () => {
  const first = await onRequestGet({
    request: new Request("https://dionys.com/api/music/playlist"),
  });
  const etag = first.headers.get("etag");
  assert.ok(etag, "response should expose an ETag header");

  const second = await onRequestGet({
    request: new Request("https://dionys.com/api/music/playlist", {
      headers: { "if-none-match": etag },
    }),
  });

  assert.equal(second.status, 304);
});
