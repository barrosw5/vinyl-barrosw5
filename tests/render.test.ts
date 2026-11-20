import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BARS, FRAMES, beatsPerLoop, foldTempo } from "../lib/animation";
import { cleanTitle, normalize } from "../lib/deezer";
import type { Track } from "../lib/lastfm";
import { renderSvg } from "../lib/render";

const playing: Track = { name: "Song", artist: "Artist", nowPlaying: true };
const paused: Track = { name: "Song", artist: "Artist", nowPlaying: false, playedAt: Math.floor(Date.now() / 1000) - 600 };

const frameCount = (svg: string) => (svg.match(/<g class="f"/g) ?? []).length;
const status = (svg: string) => svg.match(/class="(?:live|m)">&gt;&gt; ([^<]*)/)?.[1];

describe("renderSvg", () => {
  it("animates FRAMES frames while playing", () => {
    const svg = renderSvg(playing);
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.equal(frameCount(svg), FRAMES);
    assert.equal(status(svg), "now playing");
  });

  it("renders a single static frame with the tonearm parked when idle", () => {
    const svg = renderSvg(paused);
    assert.equal(frameCount(svg), 0);
    assert.equal(status(svg), "silence · last played 10 min ago");
    assert.match(svg, /-\|-/, "tonearm rest clip is drawn");
  });

  it("renders a valid card without data", () => {
    assert.equal(status(renderSvg(null)), "no data from last.fm");
  });

  it("shows the tempo in the status line", () => {
    assert.equal(status(renderSvg(playing, { bpm: 127.6 })), "now playing · 128 bpm");
  });

  it("escapes XML special characters in track metadata", () => {
    const svg = renderSvg({ name: `<b>"Rock" & Roll</b>`, artist: "A&B", nowPlaying: true });
    assert.ok(!svg.includes("<b>"), "raw markup must not leak into the SVG");
    assert.ok(svg.includes("&lt;b&gt;&quot;Rock&quot; &amp; Roll&lt;/b&gt;"));
  });

  it("draws real spectrum levels when provided", () => {
    const full = Array.from({ length: FRAMES }, () => new Array<number>(BARS).fill(1));
    const svg = renderSvg(playing, { spectrum: full });
    const fullRow = Array.from({ length: BARS }, () => "##").join(" ");
    assert.equal(svg.split(fullRow).length - 1, FRAMES * 6, "every row of every frame is full");
  });

  it("ignores a malformed spectrum and falls back to the synthetic one", () => {
    const bad = [[1, 2, 3]];
    assert.equal(renderSvg(playing, { spectrum: bad }), renderSvg(playing));
  });
});

describe("animation timing", () => {
  it("folds tempos into the displayable range by octaves", () => {
    assert.equal(foldTempo(220), 110);
    assert.equal(foldTempo(60), 120);
    assert.equal(foldTempo(128), 128);
  });

  it("fits a whole number of beats into the loop", () => {
    assert.equal(beatsPerLoop(null), 4);
    assert.equal(beatsPerLoop(125), 8); // 125 BPM × 3.84 s = 8 beats exactly
    assert.equal(beatsPerLoop(250), 8); // same pulse, double-time
  });
});

describe("catalogue matching", () => {
  it("strips featured artists, versions and remaster tags from titles", () => {
    assert.equal(cleanTitle("Strobelite (feat. Peven Everett)"), "Strobelite");
    assert.equal(cleanTitle("Song - 2011 Remaster"), "Song");
    assert.equal(cleanTitle("Track [Live]"), "Track");
    assert.equal(cleanTitle("(Untitled)"), "(Untitled)", "never strips a title to nothing");
  });

  it("compares names ignoring case, width and punctuation", () => {
    assert.equal(normalize("Feel Good Inc."), normalize("feel good inc"));
    assert.equal(normalize("ＡＢＣ"), normalize("abc"));
    assert.equal(normalize("逝生夢死"), "逝生夢死");
  });
});
