import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandLevelsDb,
  beatPhase,
  decimate,
  estimateTempo,
  fft,
  logBandEdges,
  onsetEnvelope,
  percentile,
  spectrogram,
  toMono,
} from "../lib/dsp.js";
import { clickTrack, sine, whiteNoise } from "./helpers.js";

const FFT_SIZE = 2048;
const HOP = 256;

function detect(signal: ReturnType<typeof clickTrack>) {
  const spec = spectrogram(signal, FFT_SIZE, HOP);
  return estimateTempo(onsetEnvelope(spec), spec.frameRate);
}

describe("fft", () => {
  it("puts a pure tone's energy in the expected bin", () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 8 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    assert.equal(mags.indexOf(Math.max(...mags)), 8);
    assert.ok(Math.abs(mags[8] - n / 2) < 1e-9, "amplitude is n/2 for a unit sine");
  });

  it("rejects sizes that are not a power of two", () => {
    assert.throws(() => fft(new Float64Array(100), new Float64Array(100)), RangeError);
  });
});

describe("toMono / decimate", () => {
  it("averages channels", () => {
    const mono = toMono([Float32Array.of(1, 1), Float32Array.of(0, -1)]);
    assert.deepEqual(Array.from(mono), [0.5, 0]);
  });

  it("divides the sample rate and the length", () => {
    const out = decimate({ samples: new Float32Array(1000), sampleRate: 44_100 }, 2);
    assert.equal(out.sampleRate, 22_050);
    assert.equal(out.samples.length, 500);
  });
});

describe("estimateTempo", () => {
  for (const bpm of [80, 100, 120, 128, 150]) {
    it(`detects ${bpm} BPM on a click track within 1 BPM`, () => {
      const tempo = detect(clickTrack({ bpm, seed: bpm }));
      assert.ok(tempo, "a tempo is found");
      assert.ok(Math.abs(tempo.bpm - bpm) <= 1, `expected ${bpm}, got ${tempo.bpm.toFixed(2)}`);
    });
  }

  it("returns null when there is no steady pulse", () => {
    assert.equal(detect(whiteNoise()), null);
  });

  it("returns null when the input is too short to contain several beats", () => {
    assert.equal(detect(clickTrack({ bpm: 120, seconds: 1 })), null);
  });
});

describe("beatPhase", () => {
  it("finds the offset of a periodic pulse", () => {
    const env = new Float32Array(400);
    for (let i = 7; i < env.length; i += 20) env[i] = 1;
    assert.equal(beatPhase(env, 20), 7);
  });

  it("locates beats in real onset envelopes", () => {
    const signal = clickTrack({ bpm: 120, offsetSeconds: 0.2 });
    const spec = spectrogram(signal, FFT_SIZE, HOP);
    const env = onsetEnvelope(spec);
    const period = (60 * spec.frameRate) / 120;
    const phaseSeconds = beatPhase(env, period) / spec.frameRate;
    // The onset registers once the burst is inside the analysis window, so allow one window of latency.
    const latency = FFT_SIZE / signal.sampleRate;
    assert.ok(Math.abs(phaseSeconds - 0.2) <= latency, `phase ${phaseSeconds.toFixed(3)} s`);
  });
});

describe("bandLevelsDb", () => {
  const edges = logBandEdges(21, 50, 10_000);
  const levelsFor = (hz: number, tilt: number) => {
    const spec = spectrogram(sine(hz), FFT_SIZE, HOP);
    return bandLevelsDb(spec.frames[2], spec.binHz, edges, tilt);
  };

  // Without tilt, so that band placement is tested on its own (tilt can tip near-edge tones upwards).
  for (const hz of [80, 440, 2_000, 6_000]) {
    it(`puts a ${hz} Hz tone in the band that contains it`, () => {
      const levels = levelsFor(hz, 0);
      const band = levels.indexOf(Math.max(...levels));
      assert.ok(edges[band] <= hz && hz < edges[band + 1], `band ${band}: ${edges[band]}–${edges[band + 1]} Hz`);
    });
  }

  it("applies the spectral tilt per octave around 1 kHz", () => {
    const flat = levelsFor(440, 0);
    const tilted = levelsFor(440, 3);
    const centre = (b: number) => Math.sqrt(edges[b] * edges[b + 1]);
    for (const b of [0, 10, 20]) {
      assert.ok(Math.abs(tilted[b] - flat[b] - 3 * Math.log2(centre(b) / 1000)) < 1e-9);
    }
  });

  it("produces log-spaced edges spanning the requested range", () => {
    assert.equal(edges.length, 22);
    assert.ok(Math.abs(edges[0] - 50) < 1e-9);
    assert.ok(Math.abs(edges[21] - 10_000) < 1e-6);
    const ratios = edges.slice(1).map((e, i) => e / edges[i]);
    assert.ok(ratios.every((r) => Math.abs(r - ratios[0]) < 1e-9), "constant ratio between edges");
  });
});

describe("percentile", () => {
  it("returns order statistics by nearest rank", () => {
    const values = [5, 1, 4, 2, 3];
    assert.equal(percentile(values, 0), 1);
    assert.equal(percentile(values, 0.5), 3);
    assert.equal(percentile(values, 1), 5);
    assert.ok(Number.isNaN(percentile([], 0.5)));
  });
});
