import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/audio.ts";

// The audio endpoint is fully self-hosted: it serves /music/<id>.mp3 from the
// site's own static storage and returns 404 when a track is not part of the
// library. There is no upstream resolver or KV cache to mock.
function makeAudioResponse(range = false): Response {
  return new Response("fake-audio-body", {
    status: range ? 206 : 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": "15",
      ...(range ? { "content-range": "bytes 0-14/15" } : {}),
    },
  });
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("missing or invalid song id returns 400", async () => {
  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=abc"),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "BAD_REQUEST");
});

test("returns 404 when the track is not self-hosted", async () => {
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) return new Response("Not Found", { status: 404 });
    return makeAudioResponse();
  };

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=999999"),
  });

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.code, "NOT_FOUND");
});

test("serves the self-hosted mp3 when present", async () => {
  let fetchedLocalFile = false;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) {
      fetchedLocalFile = true;
      return makeAudioResponse();
    }
    return makeAudioResponse();
  };

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=1690698"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.ok(fetchedLocalFile, "should request the local /music/<id>.mp3 file");
});

test("forwards the range header and returns 206", async () => {
  let sawRange = false;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.range) sawRange = true;
      return makeAudioResponse(true);
    }
    return makeAudioResponse();
  };

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=1690698", {
      headers: { range: "bytes=0-1023" },
    }),
  });

  assert.equal(response.status, 206);
  assert.ok(sawRange, "range header should be forwarded to the static file");
});

test("HEAD request returns headers without a body", async () => {
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) return makeAudioResponse();
    return makeAudioResponse();
  };

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=1690698", {
      method: "HEAD",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
});
