import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet, onRequestHead } from "../functions/api/music/audio.ts";

function makeAudioResponse(): Response {
  return new Response("fake-audio-body", {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": "15",
      "accept-ranges": "bytes",
    },
  });
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("invalid song id returns 400", async () => {
  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=abc"),
  });

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { code: string };
  assert.equal(payload.code, "BAD_REQUEST");
});

test("self-hosted file hit returns 200 audio stream", async () => {
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) return makeAudioResponse();
    return new Response("not found", { status: 404 });
  };

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=123"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), "fake-audio-body");
});

test("missing self-hosted file returns 404 NOT_FOUND without contacting any upstream", async () => {
  let upstreamCalled = false;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) return new Response("Not Found", { status: 404 });
    upstreamCalled = true; // any non-/music request would be an upstream call
    return makeAudioResponse();
  };

  const response = await onRequestGet({
    request: new Request("https://vesphyr.com/api/music/audio?id=999"),
  });

  assert.equal(response.status, 404);
  const payload = (await response.json()) as { code: string };
  assert.equal(payload.code, "NOT_FOUND");
  assert.equal(
    upstreamCalled,
    false,
    "must not contact any upstream when the self-hosted file is missing",
  );
});

test("HEAD request returns headers without a body", async () => {
  globalThis.fetch = async (input: string | URL | Request) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes("/music/")) return makeAudioResponse();
    return new Response("not found", { status: 404 });
  };

  const response = await onRequestHead({
    request: new Request("https://vesphyr.com/api/music/audio?id=123", {
      method: "HEAD",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});
