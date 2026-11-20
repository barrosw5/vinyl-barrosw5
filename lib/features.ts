/**
 * Audio features for the now-playing track: tempo and real spectrum frames.
 *
 * Orchestrates the Deezer lookup and the preview analysis, with a time budget,
 * memoisation and graceful degradation. This is an optional enrichment, so every
 * failure resolves to partial or `null` features, and the renderer falls back to
 * its synthetic spectrum. A slow or broken third party must never break the card.
 *
 *   artist + title ─▶ Deezer search ─▶ catalogue BPM (often missing for recent releases)
 *                                    └▶ 30 s preview ─▶ decode ─▶ detected BPM + spectrum loop
 */
import { analyse, fetchPreview } from "./audio";
import { findTrack } from "./deezer";

/** Total network budget (search + track + preview download). It sits on the critical path of an image request. */
const LOOKUP_TIMEOUT_MS = 4_000;
/** Each entry holds ~1,000 numbers (FRAMES × BARS), so 200 entries is well under 1 MB. */
const CACHE_MAX_ENTRIES = 200;

export type AudioFeatures = {
  bpm: number | null;
  /** Where `bpm` came from: Deezer's catalogue, or detected from the audio preview. */
  bpmSource: "catalogue" | "detected" | null;
  /** FRAMES × BARS levels in [0, 1] from a real excerpt of the track, or null. */
  spectrum: number[][] | null;
};

/**
 * A track's audio never changes, so complete results (including "not found") are
 * memoised for the lifetime of the serverless instance. Warm instances skip the network.
 */
const cache = new Map<string, AudioFeatures | null>();

/** Returns audio features for a track, or `null` if it isn't in the catalogue. Never throws. */
export async function getAudioFeatures(title: string, artist: string): Promise<AudioFeatures | null> {
  const key = `${artist}\u0000${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);

  let match;
  try {
    match = await findTrack(title, artist, signal);
  } catch (err) {
    console.error("Deezer lookup failed:", err);
    return null; // transient, so don't cache
  }
  if (!match) return remember(key, null);

  const catalogue: AudioFeatures = {
    bpm: match.bpm,
    bpmSource: match.bpm ? "catalogue" : null,
    spectrum: null,
  };
  if (!match.previewUrl) return remember(key, catalogue);

  try {
    const audio = await fetchPreview(match.previewUrl, signal);
    const { detectedBpm, spectrum } = analyse(audio, match.bpm);
    const bpm = match.bpm ?? detectedBpm;
    return remember(key, {
      bpm,
      bpmSource: match.bpm ? "catalogue" : detectedBpm ? "detected" : null,
      spectrum,
    });
  } catch (err) {
    console.error("Preview analysis failed:", err);
    return catalogue; // possibly transient (e.g. timeout), so don't cache
  }
}

function remember(key: string, value: AudioFeatures | null): AudioFeatures | null {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
