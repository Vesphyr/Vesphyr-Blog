import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/music/audio.ts";

// The audio endpoint is fully self-hosted: it serves /music/<id>.mp3 from the
// site's own static storage (env.ASSETS) and returns 404 when a track is not
// part of the library. There is no upstream resolver or KV cache to mock.
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

test("missing or invalid song id returns 400", async () => {
  const response = await onRequestGet(
    makeContext(
      new Request("https://vesphyr.com/api/music/audio?id=abc"),
      () => makeAudioResponse(),
    ),
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "BAD_REQUEST");
});

test("returns 404 when the track is not self-hosted", async () => {
  const response = await onRequestGet(
    makeContext(
      new Request("https://vesphyr.com/api/music/audio?id=999999"),
      (request) =>
        request.url.includes("/music/")
          ? new Response("Not Found", { status: 404 })
          : makeAudioResponse(),
    ),
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.code, "NOT_FOUND");
});

test("serves the self-hosted mp3 when present", async () => {
  let fetchedLocalFile = false;
  const response = await onRequestGet(
    makeContext(
      new Request("https://vesphyr.com/api/music/audio?id=1690698"),
      (request) => {
        if (request.url.includes("/music/")) fetchedLocalFile = true;
        return makeAudioResponse();
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.ok(fetchedLocalFile, "should request the local /music/<id>.mp3 file");
});

test("forwards the range header and returns 206", async () => {
  let sawRange = false;
  const response = await onRequestGet(
    makeContext(
      new Request("https://vesphyr.com/api/music/audio?id=1690698", {
        headers: { range: "bytes=0-1023" },
      }),
      (request) => {
        if (request.url.includes("/music/") && request.headers.get("range")) {
          sawRange = true;
        }
        return makeAudioResponse(Boolean(request.headers.get("range")));
      },
    ),
  );

  assert.equal(response.status, 206);
  assert.ok(sawRange, "range header should be forwarded to the static file");
});

test("HEAD request returns headers without a body", async () => {
  const response = await onRequestGet(
    makeContext(
      new Request("https://vesphyr.com/api/music/audio?id=1690698", {
        method: "HEAD",
      }),
      () => makeAudioResponse(),
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
});
