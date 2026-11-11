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
  env: {
    ASSETS: {
      fetch: (request: Request) => Promise<Response>;
    };
  };
};

/**
 * 这个端点只做「校验 + 跳转」，不再自己转发音频字节。
 *
 * 之前它把 ASSETS 的响应体原样透传，但 Pages Functions 的 ASSETS.fetch 并不处理
 * Range 请求头：浏览器要 `bytes=0-` 只会拿到 200 + 完整文件（单曲可达 18MB），
 * 却又带着 `Accept-Ranges: bytes`，于是 <audio> 无法分段、无法 seek，每次重试都
 * 重下整首，慢网络下会触发播放器 12s 的加载超时，表现为「无法播放，已跳过」。
 *
 * 改成 302 指向静态文件后，由 Pages 静态资源原生处理 Range（实测返回 206），
 * 跳转本身开销极小且可缓存。
 */
async function handleAudioRequest(context: RequestContext): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);
  const songId = url.searchParams.get("id")?.trim() ?? "";

  if (!/^\d+$/.test(songId)) {
    return errorResponse(400, "BAD_REQUEST", "Missing or invalid song id.");
  }

  const staticUrl = new URL(`/music/${songId}.m4a`, request.url);

  try {
    const probe = await context.env.ASSETS.fetch(
      new Request(staticUrl, { method: "HEAD" }),
    );
    if (!probe.ok) {
      probe.body?.cancel();
      return errorResponse(
        404,
        "NOT_FOUND",
        "This song is not part of the self-hosted music library.",
      );
    }
    probe.body?.cancel();

    return new Response(null, {
      status: 302,
      headers: {
        location: staticUrl.pathname,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("music:audio", error);
    return errorResponse(
      404,
      "NOT_FOUND",
      "Failed to resolve the self-hosted audio file.",
    );
  }
}

export const onRequestGet = (context: RequestContext) =>
  handleAudioRequest(context);

export const onRequestHead = (context: RequestContext) =>
  handleAudioRequest(context);
