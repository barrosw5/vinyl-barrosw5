/**
 * Animation timing shared by the renderer and the audio analyser.
 *
 * The card is a fixed-length loop: FRAMES frames of FRAME_MS each, which is one
 * revolution of the record. Anything that animates (the spectrum included) must
 * fit that loop exactly, or a visible jump appears where the loop restarts.
 */

/** Frames per loop (one full revolution). More frames are smoother but grow the SVG (~2 KB each). */
export const FRAMES = 48;
/** Duration of one frame. 48 × 80 ms = 3.84 s per loop. */
export const FRAME_MS = 80;
export const LOOP_SECONDS = (FRAMES * FRAME_MS) / 1000;

/** Number of bars in the spectrum analyser. */
export const BARS = 21;

/** Beats per loop when the track's tempo is unknown. */
export const DEFAULT_BEATS_PER_LOOP = 4;

/**
 * Tempo range the loop can show cleanly. Tempos outside it are halved or doubled
 * (half-time or double-time feel). At 160 BPM there are still ~4.8 frames per beat.
 */
export const MIN_BPM = 70;
export const MAX_BPM = 160;

/** Folds a tempo into [MIN_BPM, MAX_BPM] by octaves. Musically, 220 and 110 BPM give the same pulse. */
export function foldTempo(bpm: number): number {
  let folded = bpm;
  while (folded > MAX_BPM) folded /= 2;
  while (folded < MIN_BPM) folded *= 2;
  return folded;
}

/**
 * How many whole beats fit in one loop at the given tempo.
 *
 * The count must be an integer for the loop to be seamless, so the tempo actually
 * shown is quantised to multiples of 60 / LOOP_SECONDS ≈ 15.6 BPM. That is within
 * ±8 BPM of the real tempo, which the eye cannot tell apart.
 */
export function beatsPerLoop(bpm?: number | null): number {
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return DEFAULT_BEATS_PER_LOOP;
  return Math.max(1, Math.round((foldTempo(bpm) * LOOP_SECONDS) / 60));
}
