import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/playlist.ts";

test("music playlist api returns local tracks without contacting upstream", async () => {
  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/playlist"),
  });

  assert.equal(response.status, 200);

  const payload = (await response.json()) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(payload) && payload.length > 0);

  for (const song of payload) {
    assert.equal(typeof song.id, "number");
    assert.equal(typeof song.name, "string");
    assert.equal(typeof song.artist, "string");
    assert.equal(typeof song.url, "string");
    // Audio is served from the self-hosted static endpoint, never upstream.
    assert.ok(
      String(song.url).startsWith("/api/music/audio?id="),
      `url ${song.url} should point to the local audio endpoint`,
    );
    // Each audio URL is versioned with the playlist ETag so a swapped track
    // file cannot be served from the browser's stale mp3 cache.
    assert.ok(
      String(song.url).includes("&v="),
      `url ${song.url} should carry a version param to bust the audio cache`,
    );
  }

  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=300/);
});

test("music playlist api returns 304 when the etag matches", async () => {
  const first = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/playlist"),
  });
  const etag = first.headers.get("etag");
  assert.ok(etag, "response should expose an ETag header");

  const second = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/playlist", {
      headers: { "if-none-match": etag },
    }),
  });

  assert.equal(second.status, 304);
});
