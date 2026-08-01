export type Song = {
  id: number;
  title: string;
  artist: string;
  cover: string;
  url: string;
  duration: number;
};

function normalizeCover(cover: unknown): string {
  if (typeof cover === "string") return cover;
  if (cover && typeof cover === "object" && "src" in cover) {
    const src = (cover as { src?: unknown }).src;
    return typeof src === "string" ? src : "";
  }
  return "";
}

// Fallback unique ids for songs whose feed entry omits an id. The id is used
// as the broken-song dedup key, so duplicate/missing ids must never collapse
// onto a single value (which would break every song at once).
let generatedId = 0;

export function createSong(
  data: Partial<Song> & { title: string; artist: string },
): Song {
  return {
    id: typeof data.id === "number" && data.id > 0 ? data.id : --generatedId,
    title: data.title,
    artist: data.artist,
    cover: normalizeCover(data.cover),
    url: data.url ?? "",
    duration: data.duration ?? 0,
  };
}

export function getAssetPath(path: string | undefined | null): string {
  if (!path || typeof path !== "string") return "";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("/")) return path;
  return `/${path}`;
}
