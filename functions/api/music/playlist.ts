// Self-hosted playlist. No upstream music API is contacted at runtime.
// Song metadata is stored locally in ./playlist.json (generated once from the
// source playlist); audio is served from /music/<id>.mp3 static files.
// @ts-ignore - JSON import is bundled by the build step.
import playlistData from "./playlist.json";

export const onRequestGet = () => {
  return new Response(JSON.stringify(playlistData), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control":
        "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
};
