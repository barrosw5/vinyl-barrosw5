import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BARS, FRAMES } from "../lib/animation.js";
import { analyse } from "../lib/audio.js";
import { clickTrack, whiteNoise } from "./helpers.js";

/** analyse() expects source-rate audio (it decimates by 2), so synthesise at 44.1 kHz. */
const SOURCE_RATE = 44_100;

function assertWellFormed(spectrum: number[][] | null): asserts spectrum is number[][] {
  assert.ok(spectrum, "spectrum is produced");
  assert.equal(spectrum.length, FRAMES);
  for (const row of spectrum) {
    assert.equal(row.length, BARS);
    for (const v of row) assert.ok(v >= 0 && v <= 1, `level ${v} out of [0, 1]`);
  }
}

describe("analyse", () => {
  it("detects the tempo and builds a well-formed spectrum loop", () => {
    const result = analyse(clickTrack({ bpm: 120, seconds: 30, sampleRate: SOURCE_RATE }));
    assert.ok(result.detectedBpm && Math.abs(result.detectedBpm - 120) <= 1, `got ${result.detectedBpm}`);
    assertWellFormed(result.spectrum);
  });

  it("makes the bars pulse on the beat", () => {
    // 120 BPM gives 8 beats per 48-frame loop, so a hit every 6 frames.
    const { spectrum } = analyse(clickTrack({ bpm: 120, seconds: 30, sampleRate: SOURCE_RATE }));
    assertWellFormed(spectrum);
    const loudness = spectrum.map((row) => row.reduce((a, b) => a + b, 0));
    const onBeat = loudness.filter((_, f) => f % 6 === 0);
    const offBeat = loudness.filter((_, f) => f % 6 === 3);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(mean(onBeat) > mean(offBeat), "frames on the beat are louder than frames between beats");
  });

  it("prefers a known tempo over detection when laying out the loop", () => {
    const result = analyse(clickTrack({ bpm: 120, seconds: 30, sampleRate: SOURCE_RATE }), 120);
    assertWellFormed(result.spectrum);
  });

  it("still produces a spectrum when no tempo is found", () => {
    const result = analyse(whiteNoise({ seconds: 30, sampleRate: SOURCE_RATE }));
    assert.equal(result.detectedBpm, null);
    assertWellFormed(result.spectrum);
  });

  it("returns no spectrum for audio shorter than one loop", () => {
    const result = analyse(clickTrack({ bpm: 120, seconds: 2, sampleRate: SOURCE_RATE }));
    assert.equal(result.spectrum, null);
  });
});
