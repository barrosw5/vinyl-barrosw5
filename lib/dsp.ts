/**
 * Digital signal processing primitives for tempo detection and spectrum analysis.
 *
 * Pure functions over Float32Array, with no I/O and no dependencies. The
 * pipeline in `audio.ts` composes them:
 *
 *   PCM ─▶ mono ─▶ decimate ─▶ STFT ─┬─▶ spectral flux ─▶ autocorrelation ─▶ tempo + beat phase
 *                                    └─▶ log-spaced band levels ─▶ visualiser frames
 *
 * The methods are textbook ones, chosen for robustness over sophistication:
 * - Onset detection: log-compressed spectral flux (Bello et al., 2005).
 * - Tempo: autocorrelation of the onset envelope, weighted by a log-normal
 *   tempo prior centred on 120 BPM (Ellis, 2007).
 */

export type Signal = { samples: Float32Array; sampleRate: number };

/**
 * Magnitude spectrogram. `frames[n][k]` is the magnitude of bin k
 * (k · binHz Hz) in frame n (n / frameRate seconds).
 */
export type Spectrogram = { frames: Float32Array[]; frameRate: number; binHz: number };

export type TempoEstimate = {
  bpm: number;
  /** Beat period in spectrogram frames (fractional). */
  period: number;
  /** Normalised autocorrelation at the chosen period, in [0, 1]. Higher means a steadier pulse. */
  confidence: number;
};

// ── Conversion ───────────────────────────────────────────────────────────────

/** Averages channels into a mono signal. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i] += channel[i] / channels.length;
  }
  return out;
}

/**
 * Reduces the sample rate by an integer factor, using a box filter as a cheap
 * anti-aliasing low-pass. Good enough for analysis, though not for listening.
 */
export function decimate(signal: Signal, factor: number): Signal {
  if (factor <= 1) return signal;
  const { samples } = signal;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: signal.sampleRate / factor };
}

// ── Spectral analysis ────────────────────────────────────────────────────────

/** Twiddle factors e^(-2πik/n) for k < n/2, cached per FFT size. */
const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  let t = twiddleCache.get(n);
  if (!t) {
    const half = n >> 1;
    t = { cos: new Float64Array(half), sin: new Float64Array(half) };
    for (let k = 0; k < half; k++) {
      t.cos[k] = Math.cos((-2 * Math.PI * k) / n);
      t.sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    twiddleCache.set(n, t);
  }
  return t;
}

/** In-place iterative radix-2 Cooley–Tukey FFT. The length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n & (n - 1)) throw new RangeError(`FFT size must be a power of two, got ${n}`);
  const { cos, sin } = twiddles(n);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterflies. For a sub-transform of length `size`, twiddle k is entry k · (n / size) of the table.
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride];
        const wi = sin[k * stride];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Short-time Fourier transform with a Hann window. Returns magnitudes for bins 0..fftSize/2. */
export function spectrogram(signal: Signal, fftSize: number, hop: number): Spectrogram {
  const { samples, sampleRate } = signal;
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const bins = fftSize / 2 + 1;
  const frames: Float32Array[] = [];

  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    for (let i = 0; i < fftSize; i++) re[i] = samples[start + i] * window[i];
    im.fill(0);
    fft(re, im);
    const mag = new Float32Array(bins);
    for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]);
    frames.push(mag);
  }

  return { frames, frameRate: sampleRate / hop, binHz: sampleRate / fftSize };
}

// ── Onsets and tempo ─────────────────────────────────────────────────────────

/**
 * Onset strength envelope: half-wave rectified log-spectral flux, with the local
 * mean subtracted so that only sudden energy increases (hits) remain.
 */
export function onsetEnvelope(spec: Spectrogram): Float32Array {
  const { frames, frameRate } = spec;
  const env = new Float32Array(frames.length);
  if (frames.length < 2) return env;

  // log(1 + γ·|X|) compresses the dynamic range, so quiet hi-hats still register next to loud kicks.
  const GAMMA = 100;
  let prev = frames[0].map((m) => Math.log1p(GAMMA * m));
  for (let n = 1; n < frames.length; n++) {
    const cur = frames[n].map((m) => Math.log1p(GAMMA * m));
    let flux = 0;
    for (let k = 0; k < cur.length; k++) flux += Math.max(0, cur[k] - prev[k]);
    env[n] = flux;
    prev = cur;
  }

  // Subtract a centred moving average (~0.5 s), then rectify again.
  const half = Math.max(1, Math.round(frameRate * 0.25));
  const out = new Float32Array(env.length);
  let sum = 0;
  let count = 0;
  for (let i = -half; i < env.length; i++) {
    const add = i + half;
    const drop = i - half - 1;
    if (add < env.length) (sum += env[add]), count++;
    if (drop >= 0) (sum -= env[drop]), count--;
    if (i >= 0) out[i] = Math.max(0, env[i] - sum / count);
  }
  return out;
}

/** Same-length convolution with a centred, odd-length kernel, normalised to unit gain. */
function convolve(x: Float32Array, kernel: readonly number[]): Float32Array {
  const half = (kernel.length - 1) / 2;
  const gain = kernel.reduce((a, b) => a + b, 0);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let sum = 0;
    for (let k = 0; k < kernel.length; k++) sum += (x[i + k - half] ?? 0) * kernel[k];
    out[i] = sum / gain;
  }
  return out;
}

/** Log-normal tempo prior: listeners favour ~120 BPM, with a spread of about one octave. */
function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / 120);
  return Math.exp(-0.5 * octaves * octaves);
}

/**
 * Estimates the dominant tempo of an onset envelope.
 *
 * Scores each candidate beat period by its autocorrelation, plus half the
 * autocorrelation at twice the period (a true beat repeats at both), weighted
 * by the tempo prior. The best period is refined by parabolic interpolation.
 * Returns null when no steady pulse is found.
 */
export function estimateTempo(
  env: Float32Array,
  frameRate: number,
  // minConfidence was calibrated on 30 s previews: white noise scores 0.03–0.11, beat-driven music
  // 0.5–0.85, and ambient or rubato pieces ~0.1. Those last ones are often wrong, so they are rejected.
  { minBpm = 60, maxBpm = 200, minConfidence = 0.2 } = {}
): TempoEstimate | null {
  const n = env.length;
  const minLag = Math.max(1, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.ceil((60 * frameRate) / minBpm);
  if (n < 4 * maxLag) return null; // too short to see several beats

  // Onset peaks are only a frame or two wide, but the true beat period is rarely a whole number
  // of frames. Without smoothing, peaks drift out of alignment at integer lags. That makes the
  // autocorrelation favour 2× the period (where the rounding error is relatively smaller) and
  // causes octave errors. A short Hann kernel (~5 frames, ~60 ms) widens the peaks enough.
  const smooth = convolve(env, [0.25, 0.75, 1, 0.75, 0.25]);

  let mean = 0;
  for (let i = 0; i < n; i++) mean += smooth[i];
  mean /= n;
  const x = Float64Array.from(smooth, (v) => v - mean);

  // Unbiased autocorrelation, normalised by the energy at lag 0.
  const ac = new Float64Array(2 * maxLag + 2);
  for (let lag = 0; lag < ac.length && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s / (n - lag);
  }
  if (ac[0] <= 0) return null;
  for (let lag = ac.length - 1; lag >= 0; lag--) ac[lag] /= ac[0];

  const score = (lag: number) => (ac[lag] + 0.5 * ac[2 * lag]) * tempoPrior((60 * frameRate) / lag);

  let best = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag;
  if (ac[best] < minConfidence) return null;

  // Parabolic interpolation around the peak, for sub-frame period precision.
  let period = best;
  if (best > minLag && best < maxLag) {
    const [a, b, c] = [score(best - 1), score(best), score(best + 1)];
    const denom = a - 2 * b + c;
    if (denom < 0) period = best + (0.5 * (a - c)) / denom;
  }

  return { bpm: (60 * frameRate) / period, period, confidence: ac[best] };
}

/**
 * Finds where the beats fall: returns the offset in [0, period), in frames, that
 * maximises the onset strength summed over a grid of beats with that period.
 */
export function beatPhase(env: Float32Array, period: number): number {
  let bestOffset = 0;
  let bestSum = -Infinity;
  for (let offset = 0; offset < period; offset++) {
    let sum = 0;
    for (let t = offset; t < env.length; t += period) sum += env[Math.round(t)] ?? 0;
    if (sum > bestSum) (bestSum = sum), (bestOffset = offset);
  }
  return bestOffset;
}

// ── Band levels ──────────────────────────────────────────────────────────────

/** `count + 1` logarithmically spaced band edges from `minHz` to `maxHz`. */
export function logBandEdges(count: number, minHz: number, maxHz: number): number[] {
  const ratio = maxHz / minHz;
  return Array.from({ length: count + 1 }, (_, i) => minHz * ratio ** (i / count));
}

/**
 * Mean power per band of one spectrogram frame, in dB. A spectral tilt of
 * `tiltDbPerOctave` around 1 kHz compensates for music's natural roll-off,
 * as hardware spectrum analysers do, so that treble bars aren't always empty.
 */
export function bandLevelsDb(
  frame: Float32Array,
  binHz: number,
  edges: readonly number[],
  tiltDbPerOctave = 3
): number[] {
  const levels: number[] = [];
  for (let b = 0; b + 1 < edges.length; b++) {
    // Every band gets at least one bin, even when narrower than the bin spacing.
    const lo = Math.min(frame.length - 1, Math.round(edges[b] / binHz));
    const hi = Math.min(frame.length - 1, Math.max(lo, Math.round(edges[b + 1] / binHz) - 1));
    let power = 0;
    for (let k = lo; k <= hi; k++) power += frame[k] * frame[k];
    power /= hi - lo + 1;
    const centreHz = Math.sqrt(edges[b] * edges[b + 1]);
    levels.push(10 * Math.log10(power + 1e-12) + tiltDbPerOctave * Math.log2(centreHz / 1000));
  }
  return levels;
}

/** The p-th percentile (0–1) of the values, by nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}
