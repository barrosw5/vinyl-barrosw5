/**
 * Synthetic audio for deterministic tests: no network, no fixtures on disk.
 */
import type { Signal } from "../lib/dsp.js";

/** Seeded PRNG (mulberry32), so every test run produces identical audio. */
export function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A drum-machine-like click track: a decaying noise burst on every beat, over a
 * quiet noise floor. Beat k starts at `offsetSeconds + k · 60 / bpm`.
 */
export function clickTrack({
  bpm,
  seconds = 20,
  sampleRate = 22_050,
  offsetSeconds = 0,
  seed = 1,
}: {
  bpm: number;
  seconds?: number;
  sampleRate?: number;
  offsetSeconds?: number;
  seed?: number;
}): Signal {
  const rand = seeded(seed);
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) samples[i] = (rand() * 2 - 1) * 0.01;

  const burst = Math.floor(0.05 * sampleRate);
  for (let t = offsetSeconds; t < seconds; t += 60 / bpm) {
    const start = Math.floor(t * sampleRate);
    for (let i = 0; i < burst && start + i < samples.length; i++) {
      samples[start + i] += (rand() * 2 - 1) * Math.exp(-i / (burst / 5));
    }
  }
  return { samples, sampleRate };
}

/** A pure sine tone. */
export function sine(hz: number, { seconds = 1, sampleRate = 22_050, amplitude = 0.5 } = {}): Signal {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return { samples, sampleRate };
}

/** White noise with no rhythmic structure. */
export function whiteNoise({ seconds = 20, sampleRate = 22_050, seed = 7 } = {}): Signal {
  const rand = seeded(seed);
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) samples[i] = (rand() * 2 - 1) * 0.3;
  return { samples, sampleRate };
}
