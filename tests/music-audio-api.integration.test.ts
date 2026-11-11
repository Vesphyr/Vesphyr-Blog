import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet, onRequestHead } from "../functions/api/music/audio.ts";

// The audio endpoint is a thin resolver: it verifies that /music/<id>.m4a exists
// in the site's own static storage (env.ASSETS) and then redirects the browser
// there. It deliberately does NOT stream the bytes itself — ASSETS.fetch does not
// honour Range, so proxying the body would hand <audio> a 200 with the whole file
// while advertising `Accept-Ranges: bytes`, breaking seeking and stalling playback.
function makeContext(
  request: Request,
  assetsHandler: (request: Request) => Response,
) {
  return {
    request,
    env: {
      ASSETS: {
        fetch: async (req: Request): Promise<Response> => assetsHandler(req),
      },
    },
  };
}

const found = () => new Response(null, { status: 200 });
const missing = () => new Response("Not Found", { status: 404 });

test("missing or invalid song id returns 400", async () => {
  const response = await onRequestGet(
    makeContext(new Request("https://dionys.com/api/music/audio?id=abc"), found),
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "BAD_REQUEST");
});

test("returns 404 when the track is not self-hosted", async () => {
  const response = await onRequestGet(
    makeContext(
      new Request("https://dionys.com/api/music/audio?id=999999"),
      missing,
    ),
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.code, "NOT_FOUND");
});

test("redirects to the self-hosted m4a when present", async () => {
  let probedPath = "";
  const response = await onRequestGet(
    makeContext(
      new Request("https://dionys.com/api/music/audio?id=1690698"),
      (request) => {
        probedPath = new URL(request.url).pathname;
        return found();
      },
    ),
  );

  assert.equal(response.status, 302);
  assert.equal(probedPath, "/music/1690698.m4a");
  assert.equal(response.headers.get("location"), "/music/1690698.m4a");
});

test("range requests are answered by redirect, not by proxying bytes", async () => {
  const response = await onRequestGet(
    makeContext(
      new Request("https://dionys.com/api/music/audio?id=1690698", {
        headers: { range: "bytes=0-1023" },
      }),
      found,
    ),
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/music/1690698.m4a");
});

test("HEAD request redirects without a body", async () => {
  const response = await onRequestHead(
    makeContext(
      new Request("https://dionys.com/api/music/audio?id=1690698", {
        method: "HEAD",
      }),
      found,
    ),
  );

  assert.equal(response.status, 302);
  assert.equal(response.body, null);
});

test("asset lookup failure is reported as 404", async () => {
  const response = await onRequestGet(
    makeContext(
      new Request("https://dionys.com/api/music/audio?id=1690698"),
      () => {
        throw new Error("ASSETS unavailable");
      },
    ),
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.code, "NOT_FOUND");
});
