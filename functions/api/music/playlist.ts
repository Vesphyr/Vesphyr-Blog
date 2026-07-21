type KvLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

type RequestContext = {
  request: Request;
  env?: {
    MUSIC_KV?: KvLike;
  };
};

type MusicApiErrorCode =
  | "BAD_REQUEST"
  | "UNSUPPORTED_SOURCE"
  | "UPSTREAM_ERROR";

type UpstreamArtist = {
  name?: string;
};

type UpstreamAlbum = {
  picUrl?: string;
  blurPicUrl?: string;
};

type UpstreamTrack = {
  id?: number;
  name?: string;
  ar?: UpstreamArtist[];
  artists?: UpstreamArtist[];
  al?: UpstreamAlbum;
  album?: UpstreamAlbum;
  dt?: number;
  duration?: number;
};

type UpstreamTrackId = {
  id?: number;
};

type UpstreamPlaylistPayload = {
  result?: {
    tracks?: UpstreamTrack[];
    trackIds?: UpstreamTrackId[];
  };
  playlist?: {
    tracks?: UpstreamTrack[];
    trackIds?: UpstreamTrackId[];
  };
};

type UpstreamSongDetailPayload = {
  songs?: UpstreamTrack[];
};

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
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
  code: MusicApiErrorCode,
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

function getArtistNames(track: UpstreamTrack): string {
  const artists = track.ar ?? track.artists ?? [];
  return artists
    .map((artist) => artist.name?.trim() ?? "")
    .filter(Boolean)
    .join(" / ");
}

function normalizeUrlProtocol(url: string): string {
  if (url.startsWith("http://")) {
    return `https://${url.slice("http://".length)}`;
  }

  return url;
}

function getCoverUrl(track: UpstreamTrack): string {
  return normalizeUrlProtocol(
    track.al?.picUrl ??
      track.al?.blurPicUrl ??
      track.album?.picUrl ??
      track.album?.blurPicUrl ??
      "",
  );
}

function getTrackDuration(track: UpstreamTrack): number {
  const duration = track.dt ?? track.duration ?? 0;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function getAudioProxyUrl(id: number): string {
  return `/api/music/audio?id=${id}`;
}

function getPlaylistData(payload: UpstreamPlaylistPayload) {
  return payload.playlist ?? payload.result ?? {};
}

function getTrackIds(trackIds: UpstreamTrackId[] = []): number[] {
  return trackIds
    .map((track) => Number(track.id ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function getTrackId(track: UpstreamTrack): number {
  const id = Number(track.id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function mapTrack(track: UpstreamTrack) {
  const id = getTrackId(track);
  if (id <= 0) {
    return null;
  }

  const artist = getArtistNames(track);

  return {
    id,
    name: track.name?.trim() || "Unknown Song",
    artist: artist || "Unknown Artist",
    author: artist || "Unknown Artist",
    pic: getCoverUrl(track),
    url: getAudioProxyUrl(id),
    duration: getTrackDuration(track),
  };
}

async function fetchSongDetails(ids: number[]): Promise<UpstreamTrack[]> {
  const uniqueIds = [...new Set(ids)].filter((id) => id > 0);
  if (uniqueIds.length === 0) return [];

  const tracks: UpstreamTrack[] = [];
  for (const idChunk of chunk(uniqueIds, 100)) {
    const detailUrl = new URL("https://music.163.com/api/song/detail");
    detailUrl.searchParams.set("ids", JSON.stringify(idChunk));

    const response = await fetch(detailUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        referer: "https://music.163.com/",
      },
    });

    if (!response.ok) continue;

    const payload = (await response.json()) as UpstreamSongDetailPayload;
    tracks.push(...(payload.songs ?? []));
  }

  return tracks;
}

const PLAYLIST_KV_TTL = 300;

function getKv(env?: { MUSIC_KV?: KvLike }): KvLike | null {
  return env?.MUSIC_KV ?? null;
}

async function readKvPlaylist(
  env: { MUSIC_KV?: KvLike } | undefined,
  key: string,
): Promise<unknown[] | null> {
  try {
    const kv = getKv(env);
    if (!kv) return null;
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeKvPlaylist(
  env: { MUSIC_KV?: KvLike } | undefined,
  key: string,
  songs: unknown[],
): Promise<void> {
  try {
    const kv = getKv(env);
    if (!kv || songs.length === 0) return;
    await kv.put(key, JSON.stringify(songs), {
      expirationTtl: PLAYLIST_KV_TTL,
    });
  } catch {
    // KV write failures should never block playlist delivery.
  }
}

export const onRequestGet = async ({ request, env }: RequestContext) => {
  const url = new URL(request.url);
  const server = url.searchParams.get("server")?.trim() ?? "";
  const type = url.searchParams.get("type")?.trim() ?? "";
  const playlistId = url.searchParams.get("id")?.trim() ?? "";

  if (!playlistId) {
    return errorResponse(400, "BAD_REQUEST", "Missing playlist id.");
  }

  if (server !== "netease" || type !== "playlist") {
    return errorResponse(
      400,
      "UNSUPPORTED_SOURCE",
      "Only netease playlist requests are supported.",
    );
  }

  const kvKey = `playlist:${playlistId}`;
  const cachedSongs = await readKvPlaylist(env, kvKey);
  if (cachedSongs) {
    return json(cachedSongs, 200, {
      "cache-control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    });
  }

  const upstreamUrl = new URL("https://music.163.com/api/v6/playlist/detail");
  upstreamUrl.searchParams.set("id", playlistId);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        referer: "https://music.163.com/",
      },
    });

    if (!upstreamResponse.ok) {
      return errorResponse(
        502,
        "UPSTREAM_ERROR",
        `Music upstream returned ${upstreamResponse.status}.`,
      );
    }

    const payload = (await upstreamResponse.json()) as UpstreamPlaylistPayload;
    const playlist = getPlaylistData(payload);
    const tracks = playlist.tracks ?? [];
    const orderedTrackIds = getTrackIds(playlist.trackIds);
    const loadedTrackIds = new Set(tracks.map(getTrackId).filter(Boolean));
    const missingTrackIds = orderedTrackIds.filter(
      (id) => !loadedTrackIds.has(id),
    );
    const missingTracks = await fetchSongDetails(missingTrackIds);
    const trackById = new Map<number, UpstreamTrack>();

    for (const track of [...tracks, ...missingTracks]) {
      const id = getTrackId(track);
      if (id > 0) {
        trackById.set(id, track);
      }
    }

    const fullTracks =
      orderedTrackIds.length > 0
        ? orderedTrackIds
            .map((id) => trackById.get(id))
            .filter((track): track is UpstreamTrack => Boolean(track))
        : tracks;
    const songs = fullTracks.map(mapTrack).filter(Boolean);

    await writeKvPlaylist(env, kvKey, songs);

    return json(songs, 200, {
      "cache-control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    });
  } catch (error) {
    console.error("music:playlist", error);
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to fetch playlist from music upstream.",
    );
  }
};
