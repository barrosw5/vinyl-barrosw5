/**
 * Minimal Deezer catalogue client (public API, no key or account required).
 *
 * Resolves a Last.fm "artist + title" pair to a Deezer track, returning its
 * catalogue tempo (when Deezer has one) and the URL of its 30-second MP3 preview.
 *
 * @see https://developers.deezer.com/api/search
 * @see https://developers.deezer.com/api/track
 */

const API_ROOT = "https://api.deezer.com";
const SEARCH_LIMIT = 10;

export type DeezerTrack = {
  id: number;
  title: string;
  /** Catalogue tempo. Null when Deezer reports 0, which is common for recent releases. */
  bpm: number | null;
  /** Signed, short-lived URL of a 30 s MP3 preview. Fetch it immediately; don't store it. */
  previewUrl: string | null;
};

/** The fields we read. Every field is optional because the payload is not guaranteed. */
type DeezerError = { error?: { type?: string; message?: string; code?: number } };
type RawTrack = { id?: number; title?: string; bpm?: number; preview?: string; artist?: { name?: string } };
type SearchResponse = DeezerError & { data?: RawTrack[] };
type TrackResponse = DeezerError & RawTrack;

/**
 * Finds the best catalogue match for a track, or `null` if there is none.
 * Throws on network errors, timeouts and Deezer API errors.
 */
export async function findTrack(title: string, artist: string, signal?: AbortSignal): Promise<DeezerTrack | null> {
  const wantTitle = normalize(cleanTitle(title));
  const wantArtist = normalize(artist);

  // Free-text search is fuzzy (Deezer's advanced `artist:"…"` syntax returns nothing for many
  // queries), so keep only hits by the same artist, and prefer an exact title match.
  const search = await request<SearchResponse>(
    "/search",
    { q: `${artist} ${cleanTitle(title)}`, limit: String(SEARCH_LIMIT) },
    signal
  );
  const sameArtist = (search.data ?? []).filter((t) => t.id && normalize(t.artist?.name ?? "") === wantArtist);
  const best = sameArtist.find((t) => normalize(cleanTitle(t.title ?? "")) === wantTitle) ?? sameArtist[0];
  if (!best?.id) return null;

  // Search results omit `bpm`, so the tempo needs a second request.
  const track = await request<TrackResponse>(`/track/${best.id}`, {}, signal);
  const bpm = Number(track.bpm);

  return {
    id: best.id,
    title: track.title ?? best.title ?? title,
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
    previewUrl: track.preview || best.preview || null,
  };
}

async function request<T extends DeezerError>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, API_ROOT);
  url.search = new URLSearchParams(params).toString();

  const res = await fetch(url, { headers: { "User-Agent": "vinyl-now-playing" }, signal });
  if (!res.ok) throw new Error(`Deezer responded with HTTP ${res.status}`);

  // Deezer reports API errors (e.g. quota exceeded) with HTTP 200 and an `error` object.
  const body = (await res.json()) as T;
  if (body.error) throw new Error(`Deezer error ${body.error.code}: ${body.error.message}`);
  return body;
}

/** Case-, width- and punctuation-insensitive form for comparing names across catalogues. */
export function normalize(s: string): string {
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
