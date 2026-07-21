import { createSong, type Song } from "./player-types";

interface FetchMetingPlaylistSongsOptions {
  apiTemplate: string;
  id: string;
  server: string;
  type: string;
  unknownSongLabel: string;
  unknownArtistLabel: string;
}

const PLAYLIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CachedPlaylist = {
  cachedAt: number;
  songs: Song[];
};

function getPlaylistCacheKey(options: FetchMetingPlaylistSongsOptions): string {
  return [
    "vesphyr:music-playlist",
    options.server,
    options.type,
    options.id,
    options.apiTemplate,
  ].join(":");
}

function isValidSong(song: unknown): song is Song {
  if (!song || typeof song !== "object") return false;
  const candidate = song as Partial<Song>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.artist === "string" &&
    typeof candidate.cover === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.duration === "number"
  );
}

function readCachedPlaylist(cacheKey: string): Song[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const rawCache = localStorage.getItem(cacheKey);
    if (!rawCache) return null;

    const cached = JSON.parse(rawCache) as CachedPlaylist;
    if (
      !cached ||
      !Number.isFinite(cached.cachedAt) ||
      Date.now() - cached.cachedAt > PLAYLIST_CACHE_TTL_MS ||
      !Array.isArray(cached.songs) ||
      !cached.songs.every(isValidSong)
    ) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return cached.songs;
  } catch {
    return null;
  }
}

function writeCachedPlaylist(cacheKey: string, songs: Song[]) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        cachedAt: Date.now(),
        songs,
      } satisfies CachedPlaylist),
    );
  } catch {
    // Ignore quota and private browsing errors; playback should still work.
  }
}

export async function fetchMetingPlaylistSongs(
  options: FetchMetingPlaylistSongsOptions,
): Promise<Song[]> {
  const {
    apiTemplate,
    id,
    server,
    type,
    unknownSongLabel,
    unknownArtistLabel,
  } = options;
  const cacheKey = getPlaylistCacheKey(options);
  const cachedSongs = readCachedPlaylist(cacheKey);
  if (cachedSongs) {
    return cachedSongs;
  }

  const apiUrl = apiTemplate
    .replace(":server", server)
    .replace(":type", type)
    .replace(":id", id)
    .replace(":auth", "")
    .replace(":r", Date.now().toString());

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error("meting api error");
  }

  const list = await response.json();
  const songs = list.map((song: any) => {
    let title = song.name ?? song.title ?? unknownSongLabel;
    let artist = song.artist ?? song.author ?? unknownArtistLabel;
    let duration = song.duration ?? 0;
    if (duration > 10000) duration = Math.floor(duration / 1000);
    if (!Number.isFinite(duration) || duration <= 0) duration = 0;

    return createSong({
      id: song.id,
      title,
      artist,
      cover: song.pic ?? "",
      url: song.url ?? "",
      duration,
    });
  });

  writeCachedPlaylist(cacheKey, songs);
  return songs;
}
