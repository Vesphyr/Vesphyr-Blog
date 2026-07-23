// @ts-ignore - JSON import is bundled by the build step.
import playlistData from "./playlist.json";

function hashString(input: string): string {
  // FNV-1a 32-bit hash, returned as 8-char hex. Stable per content.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const onRequestGet = (context: { request: Request }) => {
  const body = JSON.stringify(playlistData);
  const etag = `"${hashString(body)}"`;
  const ifNoneMatch = context.request.headers.get("if-none-match");

  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control":
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    etag,
  };

  // Client sends its cached ETag via If-None-Match. When the playlist
  // content is unchanged the function replies 304 (no body), so the
  // browser keeps serving the cached list without re-downloading, but the
  // moment the playlist changes (e.g. after a deploy) the ETag differs and
  // the fresh list is returned. This keeps edits visible immediately
  // instead of being hidden behind a fixed TTL.
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }

  // Stamp every audio URL with the playlist ETag as a version query param
  // (...&v=<etag>). The audio endpoint only reads `id` and ignores `v`, so
  // playback is unaffected, but when the playlist changes the URL changes
  // too — which forces the browser to bypass any cached copy of the old
  // .mp3 (the audio endpoint sets a long max-age) and fetch the new file.
  // Without this, swapping a track's audio left the old file served for up
  // to 24h because the URL stayed identical.
  const version = etag.replace(/"/g, "");
  const versioned = (playlistData as Array<Record<string, unknown>>).map(
    (song) => {
      const url = song.url;
      if (typeof url !== "string" || !url) return song;
      const parsed = new URL(url, "https://music.local/");
      parsed.searchParams.set("v", version);
      return { ...song, url: parsed.pathname + parsed.search };
    },
  );

  return new Response(JSON.stringify(versioned), { status: 200, headers });
};
