type MusicAudioErrorCode = "BAD_REQUEST" | "NOT_FOUND";

function json(
  data: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorResponse(
  status: number,
  code: MusicAudioErrorCode,
  message: string,
): Response {
  return json(
    {
      ok: false,
      code,
      message,
    },
    status,
    {
      "cache-control": "no-store",
    },
  );
}

type RequestContext = {
  request: Request;
};

async function handleAudioRequest(context: RequestContext): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);
  const songId = url.searchParams.get("id")?.trim() ?? "";

  if (!/^\d+$/.test(songId)) {
    return errorResponse(400, "BAD_REQUEST", "Missing or invalid song id.");
  }

  const range = request.headers.get("range");

  try {
    const staticUrl = new URL(`/music/${songId}.mp3`, request.url);
    const staticResponse = await fetch(staticUrl, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: range ? { range } : {},
    });

    if (staticResponse.ok || staticResponse.status === 206) {
      const headers = new Headers();
      const ct = staticResponse.headers.get("content-type");
      headers.set("content-type", ct ?? "audio/mpeg");
      headers.set("cache-control", "public, max-age=86400, s-maxage=86400");
      headers.set("accept-ranges", "bytes");
      const cl = staticResponse.headers.get("content-length");
      if (cl) headers.set("content-length", cl);
      const cr = staticResponse.headers.get("content-range");
      if (cr) headers.set("content-range", cr);
      const etag = staticResponse.headers.get("etag");
      if (etag) headers.set("etag", etag);
      return new Response(
        request.method === "HEAD" ? null : staticResponse.body,
        { status: staticResponse.status, headers },
      );
    }

    staticResponse.body?.cancel();
    return errorResponse(
      404,
      "NOT_FOUND",
      "This song is not part of the self-hosted music library.",
    );
  } catch (error) {
    console.error("music:audio", error);
    return errorResponse(
      404,
      "NOT_FOUND",
      "Failed to load the self-hosted audio file.",
    );
  }
}

export const onRequestGet = (context: RequestContext) =>
  handleAudioRequest(context);

export const onRequestHead = (context: RequestContext) =>
  handleAudioRequest(context);
