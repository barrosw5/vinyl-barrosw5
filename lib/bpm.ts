/**
 * Tempo (BPM) lookup via the GetSongBPM API.
 *
 * Optional enrichment: every failure (missing key, no match, network error,
 * unexpected payload) resolves to `null`, and the renderer then falls back
 * to its default beat. A slow or broken third party must never break the card.
 *
 * GetSongBPM is free, but its terms require a visible backlink to
 * https://getsongbpm.com wherever the data is shown.
 *
 * @see https://getsongbpm.com/api
 */

const API_ROOT = "https://api.getsong.co";
/** Kept short: this sits on the critical path of an image request. */
const REQUEST_TIMEOUT_MS = 2_500;
const CACHE_MAX_ENTRIES = 500;

/**
 * A song's tempo never changes, so results (including misses) are memoised for the
 * lifetime of the serverless instance. Warm instances skip the network entirely.
 */
const cache = new Map<string, number | null>();

/** The fields we read from search hits and from `/song/` responses. Every field is optional because the payload is not guaranteed. */
type RawSong = { id?: string; title?: string; tempo?: string | number };
type SearchResponse = { search?: RawSong[] | { error?: string } };
type SongResponse = { song?: RawSong };

/**
 * Returns the tempo in BPM for a track, or `null` if it is unknown.
 * Never throws.
 */
export async function getTempo(title: string, artist: string, apiKey: string): Promise<number | null> {
  const cacheKey = `${artist}\u0000${title}`.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  let bpm: number | null = null;
  try {
    bpm = await lookupTempo(cleanTitle(title), artist, apiKey);
  } catch (err) {
    console.error("GetSongBPM lookup failed:", err);
    return null; // don't cache transient failures
  }

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, bpm);
  return bpm;
}

async function lookupTempo(title: string, artist: string, apiKey: string): Promise<number | null> {
  const search = await request<SearchResponse>("/search/", {
    api_key: apiKey,
    type: "both",
    lookup: `song:${title} artist:${artist}`,
    limit: "1",
  });

  // Responses with no matches return `{ search: { error: "no result" } }` instead of an array.
  const hit = Array.isArray(search.search) ? search.search[0] : undefined;
  if (!hit) return null;

  // Search hits may carry the tempo directly. Otherwise, resolve it via the song endpoint.
  const direct = parseTempo(hit.tempo);
  if (direct !== null || !hit.id) return direct;

  const detail = await request<SongResponse>("/song/", { api_key: apiKey, id: hit.id });
  return parseTempo(detail.song?.tempo);
}

async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, API_ROOT);
  url.search = new URLSearchParams(params).toString();

  const res = await fetch(url, {
    headers: { "User-Agent": "vinyl-now-playing" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GetSongBPM responded with HTTP ${res.status}`);
  return (await res.json()) as T;
}

function parseTempo(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Strips decorations that Last.fm titles often carry but catalogues don't,
 * e.g. "Strobelite (feat. Peven Everett)" or "Song - 2011 Remaster" become "Strobelite" and "Song".
 */
export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[([][^)\]]*[)\]]/g, "") // (feat. …), [Live], (Remastered) …
    .replace(/\s+-\s+.*$/, "") //            " - 2011 Remaster", " - Radio Edit" …
    .trim();
  return cleaned || title;
}
