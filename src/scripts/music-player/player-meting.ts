import { createSong, type Song } from "./player-types";

// The playlist lives in a self-hosted endpoint (/api/music/playlist). Its
// ETag is derived from the playlist content, so any deploy that changes the
// list invalidates the cached copy automatically — no fixed TTL that could
// hide edits for hours.
const LS_ETAG_KEY = "vesphyr:music-playlist-etag";
const LS_SONGS_KEY = "vesphyr:music-playlist-songs";

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

function readCachedSongs(): Song[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_SONGS_KEY);
    if (!raw) return null;

    const songs = JSON.parse(raw) as Song[];
    if (!Array.isArray(songs) || !songs.every(isValidSong)) {
      localStorage.removeItem(LS_SONGS_KEY);
      return null;
    }

    return songs;
  } catch {
    return null;
  }
}

function readCachedEtag(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(LS_ETAG_KEY);
  } catch {
    return null;
  }
}

function writeCache(etag: string | null, songs: Song[]) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_SONGS_KEY, JSON.stringify(songs));
    if (etag) localStorage.setItem(LS_ETAG_KEY, etag);
  } catch {
    // Ignore quota and private browsing errors; playback should still work.
  }
}

interface FetchLocalPlaylistSongsOptions {
  endpoint: string;
  unknownSongLabel: string;
  unknownArtistLabel: string;
}

export async function fetchLocalPlaylistSongs(
  options: FetchLocalPlaylistSongsOptions,
): Promise<Song[]> {
  const { endpoint, unknownSongLabel, unknownArtistLabel } = options;

  const cachedSongs = readCachedSongs();
  const cachedEtag = readCachedEtag();

  const headers: Record<string, string> = {};
  if (cachedEtag) headers["If-None-Match"] = cachedEtag;

  const response = await fetch(endpoint, { headers });

  // 304 Not Modified: playlist unchanged since the cached copy was stored.
  if (response.status === 304 && cachedSongs) {
    return cachedSongs;
  }

  if (!response.ok) {
    throw new Error("playlist request failed");
  }

  const etag = response.headers.get("etag");
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

  writeCache(etag, songs);
  return songs;
}
