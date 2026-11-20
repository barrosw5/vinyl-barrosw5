/**
 * Minimal Last.fm client.
 *
 * Fetches the most recent scrobble for a user via `user.getRecentTracks`.
 * Only the fields the renderer needs are mapped; everything else is dropped.
 *
 * @see https://www.last.fm/api/show/user.getRecentTracks
 */

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const REQUEST_TIMEOUT_MS = 5_000;

export type Track = {
  name: string;
  artist: string;
  album?: string;
  /** True while the track is currently being scrobbled ("now playing"). */
  nowPlaying: boolean;
  /** Unix timestamp (seconds) of when the track finished; absent while now playing. */
  playedAt?: number;
};

/** Subset of the raw `user.getRecentTracks` payload that we actually read. */
type RawTrack = {
  name: string;
  artist?: { "#text"?: string; name?: string };
  album?: { "#text"?: string };
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
};

type RecentTracksResponse = {
  recenttracks?: { track?: RawTrack | RawTrack[] };
  error?: number;
  message?: string;
};

/**
 * Returns the user's latest track, or `null` if they have no scrobbles.
 * Throws on network errors, non-2xx responses, timeouts, and Last.fm API errors.
 */
export async function getLastTrack(user: string, apiKey: string): Promise<Track | null> {
  const url = new URL(API_ROOT);
  url.search = new URLSearchParams({
    method: "user.getrecenttracks",
    user,
    api_key: apiKey,
    limit: "1",
    format: "json",
  }).toString();

  const res = await fetch(url, {
    headers: { "User-Agent": "vinyl-now-playing" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Last.fm responded with HTTP ${res.status}`);

  const data = (await res.json()) as RecentTracksResponse;
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);

  // Last.fm returns a single object instead of an array when there is only one item.
  const list = data.recenttracks?.track;
  const raw = Array.isArray(list) ? list[0] : list;
  if (!raw) return null;

  return {
    name: raw.name,
    artist: raw.artist?.["#text"] ?? raw.artist?.name ?? "Unknown",
    album: raw.album?.["#text"] || undefined,
    nowPlaying: raw["@attr"]?.nowplaying === "true",
    playedAt: raw.date?.uts ? Number(raw.date.uts) : undefined,
  };
}
