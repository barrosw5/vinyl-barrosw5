/**
 * Tempo (BPM) lookup via Deezer's public API (no key or account required).
 *
 * Optional enrichment: every failure (no match, track without tempo data,
 * network error, rate limit, unexpected payload) resolves to `null`, and the
 * renderer then falls back to its default beat. A slow or broken third party
 * must never break the card.
 *
 * Deezer's search does not return tempo, so this is two steps: search by
 * "artist title", keep the hits by the same artist, then read `bpm` from
 * `/track/{id}`. Many tracks (often live versions) report `bpm: 0`, so a few
 * candidates are tried, and exact title matches go first.
 *
 * @see https://developers.deezer.com/api/search
 * @see https://developers.deezer.com/api/track
 */

const API_ROOT = "https://api.deezer.com";
/** Total budget for the whole lookup. It sits on the critical path of an image request. */
const LOOKUP_TIMEOUT_MS = 3_000;
const SEARCH_LIMIT = 10;
/** Max `/track` requests per lookup. Keeps well under Deezer's quota of 50 requests per 5 s. */
const MAX_CANDIDATES = 3;
const CACHE_MAX_ENTRIES = 500;

/**
 * A song's tempo never changes, so results (including misses) are memoised for the
 * lifetime of the serverless instance. Warm instances skip the network entirely.
 */
const cache = new Map<string, number | null>();

/** The fields we read. Every field is optional because the payload is not guaranteed. */
type DeezerError = { error?: { type?: string; message?: string; code?: number } };
type SearchHit = { id?: number; title?: string; artist?: { name?: string } };
type SearchResponse = DeezerError & { data?: SearchHit[] };
type TrackResponse = DeezerError & { bpm?: number };

/**
 * Returns the tempo in BPM for a track, or `null` if it is unknown.
 * Never throws.
 */
export async function getTempo(title: string, artist: string): Promise<number | null> {
  const cacheKey = `${artist}\u0000${title}`.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  let bpm: number | null;
  try {
    bpm = await lookupTempo(cleanTitle(title), artist, AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
  } catch (err) {
    console.error("Deezer tempo lookup failed:", err);
    return null; // don't cache transient failures
  }

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, bpm);
  return bpm;
}

async function lookupTempo(title: string, artist: string, signal: AbortSignal): Promise<number | null> {
  const search = await request<SearchResponse>("/search", { q: `${artist} ${title}`, limit: String(SEARCH_LIMIT) }, signal);

  // Free-text search is fuzzy, so keep only hits by the same artist, with exact title matches first.
  const wantArtist = normalize(artist);
  const wantTitle = normalize(title);
  const candidates = (search.data ?? [])
    .filter((hit) => hit.id && normalize(hit.artist?.name ?? "") === wantArtist)
    .sort((a, b) => rankTitle(b, wantTitle) - rankTitle(a, wantTitle))
    .slice(0, MAX_CANDIDATES);

  for (const hit of candidates) {
    const track = await request<TrackResponse>(`/track/${hit.id}`, {}, signal);
    const bpm = parseTempo(track.bpm);
    if (bpm !== null) return bpm;
  }
  return null;
}

async function request<T extends DeezerError>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const url = new URL(path, API_ROOT);
  url.search = new URLSearchParams(params).toString();

  const res = await fetch(url, { headers: { "User-Agent": "vinyl-now-playing" }, signal });
  if (!res.ok) throw new Error(`Deezer responded with HTTP ${res.status}`);

  // Deezer reports API errors (e.g. quota exceeded) with HTTP 200 and an `error` object.
  const body = (await res.json()) as T;
  if (body.error) throw new Error(`Deezer error ${body.error.code}: ${body.error.message}`);
  return body;
}

function rankTitle(hit: SearchHit, wantTitle: string): number {
  return normalize(cleanTitle(hit.title ?? "")) === wantTitle ? 1 : 0;
}

function parseTempo(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Case-, width- and punctuation-insensitive form for comparing names across catalogues. */
function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Strips decorations that titles often carry but catalogues don't share,
 * e.g. "Strobelite (feat. Peven Everett)" or "Song - 2011 Remaster" become "Strobelite" and "Song".
 */
export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[([][^)\]]*[)\]]/g, "") // (feat. …), [Live], (Remastered) …
    .replace(/\s+-\s+.*$/, "") //            " - 2011 Remaster", " - Radio Edit" …
    .trim();
  return cleaned || title;
}
