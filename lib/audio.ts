/**
 * Audio analysis of a track preview: tempo detection and spectrum visualiser frames.
 *
 * Decodes a short MP3 (Deezer's 30 s previews) with a WebAssembly build of
 * mpg123. That build has no native binaries, so it runs unchanged on Vercel.
 * The decoded audio is turned into:
 *
 * - a tempo estimate (used when the catalogue has none), and
 * - FRAMES × BARS spectrum levels. These come from a real excerpt of the song
 *   that starts on a beat and lasts a whole number of beats, so the excerpt
 *   loops in time with the record.
 */
import { BARS, FRAMES, LOOP_SECONDS, beatsPerLoop, foldTempo } from "./animation.js";
import {
  bandLevelsDb,
  beatPhase,
  decimate,
  estimateTempo,
  logBandEdges,
  onsetEnvelope,
  percentile,
  spectrogram,
  toMono,
  type Signal,
  type Spectrogram,
} from "./dsp.js";

/** 44.1 kHz ÷ 2 = 22.05 kHz keeps content up to ~11 kHz (hi-hats) while halving the work. */
const DECIMATION = 2;
/** At 22.05 kHz this gives 10.8 Hz bins (enough for bass bands) and 11.6 ms hops (enough for onsets). */
const FFT_SIZE = 2048;
const HOP = 256;

const BAND_MIN_HZ = 50;
const BAND_MAX_HZ = 10_000;
/** Dynamic range mapped onto the bar height. Anything quieter than this below the peak shows as empty. */
const DISPLAY_RANGE_DB = 30;
/** How fast a bar can fall per frame (fraction of full height). Mimics the "release" of hardware analysers. */
const RELEASE_PER_FRAME = 0.15;
/** Guard against unexpectedly large downloads. A 30 s 128 kbps preview is about 480 KB. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * The decoder is loaded lazily, on first use, and never at module load. If it cannot be loaded
 * in some runtime, only the audio enrichment fails, and that failure is caught upstream, so the
 * endpoint keeps serving cards. A static import would take the whole function down with it.
 */
let decoderModule: Promise<typeof import("mpg123-decoder")> | undefined;

function loadDecoder(): Promise<typeof import("mpg123-decoder")> {
  decoderModule ??= import("mpg123-decoder").catch((err: unknown) => {
    decoderModule = undefined; // allow a retry on the next request
    throw err;
  });
  return decoderModule;
}

export type AudioAnalysis = {
  /** Tempo detected from the audio, or null when no steady pulse was found. */
  detectedBpm: number | null;
  /** FRAMES × BARS levels in [0, 1], ready for the renderer. */
  spectrum: number[][] | null;
};

/** Downloads and decodes an MP3 into a mono signal. */
export async function fetchPreview(url: string, signal?: AbortSignal): Promise<Signal> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Preview download failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_PREVIEW_BYTES) throw new Error(`Preview too large (${declared} bytes)`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error(`Preview too large (${bytes.byteLength} bytes)`);

  // One decoder per call: concurrent invocations can share a warm instance, and decoders hold state.
  const { MPEGDecoder } = await loadDecoder();
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const { channelData, samplesDecoded, sampleRate } = decoder.decode(bytes);
    if (samplesDecoded === 0) throw new Error("Preview decoded to no audio");
    return { samples: toMono(channelData), sampleRate };
  } finally {
    decoder.free();
  }
}

/**
 * Analyses decoded audio. A `knownBpm` (e.g. from the catalogue) takes precedence
 * over detection when laying out the beat grid.
 */
export function analyse(audio: Signal, knownBpm?: number | null): AudioAnalysis {
  const spec = spectrogram(decimate(audio, DECIMATION), FFT_SIZE, HOP);
  const env = onsetEnvelope(spec);
  const tempo = estimateTempo(env, spec.frameRate);
  const bpm = knownBpm ?? tempo?.bpm ?? null;

  return {
    detectedBpm: tempo ? tempo.bpm : null,
    spectrum: spectrumLoop(spec, env, bpm),
  };
}

/**
 * Turns a spectrogram into FRAMES × BARS visualiser levels.
 *
 * With a tempo, the excerpt starts on a detected beat and spans exactly
 * `beatsPerLoop(bpm)` beats, played back slightly faster or slower to fill
 * LOOP_SECONDS (by up to ~11% at the slowest folded tempos, usually much less). The loop then lands on a downbeat. Without a tempo,
 * it takes LOOP_SECONDS of audio as is. In both cases, the busiest candidate
 * section of the preview is used.
 */
export function spectrumLoop(spec: Spectrogram, env: Float32Array, bpm: number | null): number[][] | null {
  const { frames, frameRate, binHz } = spec;

  let length: number; // excerpt length, in spectrogram frames
  let starts: number[]; // candidate excerpt starts
  if (bpm) {
    const period = (60 * frameRate) / foldTempo(bpm);
    length = beatsPerLoop(bpm) * period;
    starts = [];
    for (let s = beatPhase(env, period); s + length <= frames.length; s += period) starts.push(s);
  } else {
    length = LOOP_SECONDS * frameRate;
    const step = Math.round(frameRate / 4);
    starts = [];
    for (let s = 0; s + length <= frames.length; s += step) starts.push(s);
  }
  if (starts.length === 0) return null;

  // Pick the section with the most onset activity: usually a chorus or drop rather than an intro.
  const activity = (s: number) => {
    let sum = 0;
    for (let n = Math.floor(s); n < s + length; n++) sum += env[n];
    return sum;
  };
  const start = starts.reduce((best, s) => (activity(s) > activity(best) ? s : best));

  // Peak level per band within each output frame's time slot, so short hits between samples aren't lost.
  const edges = logBandEdges(BARS, BAND_MIN_HZ, Math.min(BAND_MAX_HZ, binHz * (frames[0].length - 1)));
  const levels: number[][] = [];
  for (let f = 0; f < FRAMES; f++) {
    const from = Math.floor(start + (f * length) / FRAMES);
    const to = Math.max(from + 1, Math.floor(start + ((f + 1) * length) / FRAMES));
    const peak = new Array<number>(BARS).fill(-Infinity);
    for (let n = from; n < to && n < frames.length; n++) {
      bandLevelsDb(frames[n], binHz, edges).forEach((db, b) => (peak[b] = Math.max(peak[b], db)));
    }
    levels.push(peak);
  }

  // Normalise against the excerpt's own loud end, so quiet and loud masters both fill the display.
  const ceiling = percentile(levels.flat(), 0.98);
  const floor = ceiling - DISPLAY_RANGE_DB;
  const out = levels.map((row) => row.map((db) => Math.min(1, Math.max(0, (db - floor) / DISPLAY_RANGE_DB))));

  // Fast attack, slow release. Two passes, because the loop is cyclic and frame 0 follows the last frame.
  for (let pass = 0; pass < 2; pass++) {
    for (let f = 0; f < FRAMES; f++) {
      const prev = out[(f + FRAMES - 1) % FRAMES];
      for (let b = 0; b < BARS; b++) out[f][b] = Math.max(out[f][b], prev[b] - RELEASE_PER_FRAME);
    }
  }
  return out;
}
