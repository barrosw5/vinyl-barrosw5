/**
 * SVG renderer: a spinning ASCII vinyl record plus a fake spectrum analyser.
 *
 * GitHub READMEs cannot run JavaScript, but they do display SVG images, and
 * SVG supports CSS animations. So every animation frame is pre-rendered as a
 * group of <text> rows, and a CSS keyframe flips their opacity so exactly one
 * frame is visible at any time, like a flipbook.
 *
 * Everything here is a pure function of (track, current time), with no I/O.
 */
import type { Track } from "./lastfm";

// ── Configuration ────────────────────────────────────────────────────────────

/** Vinyl canvas size, in character cells. */
const W = 64;
const H = 19;

/** Frames per full revolution. More frames are smoother but grow the SVG (~2 KB each). */
const FRAMES = 48;
/** Duration of one frame. 48 × 80 ms ≈ 3.8 s per revolution. */
const FRAME_MS = 80;

/** Spectrum analyser: number of bars and their max height in rows. */
const BARS = 21;
const BAR_H = 6;

/** Brightness ramp used for the grooves, darkest → brightest. */
const SHADE = " .:-=+*#%@";

/** Typography and layout, in px. CHAR_W must match the monospace advance at FONT_SIZE. */
const FONT_SIZE = 12;
const LINE_H = 14;
const CHAR_W = 7.25;
const PAD = 20;

/** Max characters for title/artist before truncating with an ellipsis. */
const MAX_TEXT = 52;

/** Palette matches GitHub's dark theme. */
const COLORS = {
  bg: "#0d1117",
  border: "#30363d",
  vinyl: "#c9d1d9",
  spectrum: "#00d4ff",
  title: "#ffffff",
  muted: "#8b949e",
  live: "#3fb950",
} as const;

/** User-facing strings rendered into the card. */
const LABELS = {
  nowPlaying: ">> now playing",
  silence: (ago: string) => (ago ? `>> silence · last played ${ago}` : ">> silence"),
  noData: ">> no data from last.fm",
  noTrackAlt: "No track",
  justNow: "just now",
  minutesAgo: (n: number) => `${n} min ago`,
  hoursAgo: (n: number) => `${n} h ago`,
  daysAgo: (n: number) => (n === 1 ? "1 day ago" : `${n} days ago`),
} as const;

const TAU = Math.PI * 2;

// ── Utilities ────────────────────────────────────────────────────────────────

/** 32-bit FNV-1a hash. Gives each track a stable seed so its spectrum looks the same on every render. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32: a tiny seedable PRNG returning floats in [0, 1). */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Escapes text for safe interpolation into XML content and attribute values. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Human-readable relative time for a Unix timestamp in seconds. */
function timeAgo(unixSeconds?: number): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 60) return LABELS.justNow;
  if (diff < 3600) return LABELS.minutesAgo(Math.floor(diff / 60));
  if (diff < 86400) return LABELS.hoursAgo(Math.floor(diff / 3600));
  return LABELS.daysAgo(Math.floor(diff / 86400));
}

// ── 1. Vinyl ─────────────────────────────────────────────────────────────────

/** A sprite drawn over the disc, as [row, col, char] cells. Coordinates assume W = 64. */
type Sprite = readonly (readonly [number, number, string])[];

/** Tonearm lowered diagonally onto the record, with the stylus in the grooves. */
const TONEARM_PLAYING: Sprite = [
  [0, 55, "("], [0, 56, "O"], [0, 57, ")"],
  [1, 56, "|"], [2, 55, "/"], [3, 54, "/"], [4, 53, "/"], [5, 52, "/"],
  [6, 51, "/"], [7, 50, "/"], [8, 49, "/"], [9, 48, "/"], [10, 47, "/"],
  [11, 44, "["], [11, 45, "="], [11, 46, "]"],
];

/** Tonearm parked straight down beside the record, held by its rest clip ("-|-"). */
const TONEARM_RESTING: Sprite = [
  [0, 55, "("], [0, 56, "O"], [0, 57, ")"],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => [row, 56, "|"] as const),
  [8, 55, "-"], [8, 57, "-"],
  [11, 55, "["], [11, 56, "="], [11, 57, "]"],
];

/**
 * Rasterises one frame of the record at the given rotation (radians).
 * `armDown` selects the tonearm pose: on the record while playing, parked otherwise.
 *
 * Each cell is mapped to normalised polar coordinates around the disc centre.
 * Using different x/y radii draws an ellipse, which reads as a record seen in
 * slight perspective. The radius `r` selects the zone (spindle, label,
 * grooves, outside) and the angle drives the rotation-dependent details.
 */
function vinylFrame(rotation: number, armDown: boolean): string[] {
  const cx = W * 0.4;
  // A sub-row offset keeps the scratch line from aliasing onto a single text row.
  const cy = (H - 1) / 2 + 0.31;
  const rx = W * 0.37;
  const ry = (H - 1) / 2;

  const grid: string[][] = [];
  for (let j = 0; j < H; j++) {
    const row: string[] = [];
    for (let i = 0; i < W; i++) {
      const x = (i - cx) / rx;
      const y = (j - cy) / ry;
      const r = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      let c = " ";

      if (r < 0.07) {
        c = "o"; // spindle hole
      } else if (r < 0.32) {
        // Label, with one highlighted wedge that rotates with the disc.
        const a = (((ang - rotation) % TAU) + TAU) % TAU;
        c = a < 0.9 ? "#" : r < 0.2 ? "=" : "-";
      } else if (r < 1) {
        // Grooves: concentric rings from a sine of the radius.
        const groove = 0.5 + 0.5 * Math.sin(r * 45);
        // Specular sheen is fixed in screen space and does not rotate, as on a real record.
        const sheen = Math.max(0, Math.cos(ang + 0.8)) ** 6;
        // Scratches rotate with the disc. They are what makes the spin visible.
        const scratch = Math.abs(Math.sin((ang - rotation) * 3)) < 0.05 ? 0.5 : 0;
        const v = Math.min(0.99, 0.15 + groove * 0.3 + sheen * 0.6 + scratch);
        c = SHADE[Math.floor(v * SHADE.length)];
      }
      row.push(c);
    }
    grid.push(row);
  }

  const arm = armDown ? TONEARM_PLAYING : TONEARM_RESTING;
  for (const [j, i, ch] of arm) if (grid[j] && i < W) grid[j][i] = ch;

  return grid.map((r) => r.join("").replace(/\s+$/, ""));
}

// ── 2. Spectrum ──────────────────────────────────────────────────────────────

/**
 * Builds the spectrum analyser frames.
 *
 * There is no audio, so the bars are synthetic but deterministic: the PRNG is
 * seeded from the track, so a given song always "looks" the same. Every
 * oscillator completes a whole number of cycles per FRAMES, so the loop is
 * seamless. When paused, returns a single flat frame.
 */
function spectrumFrames(seedText: string, playing: boolean): string[][] {
  const rand = rng(hash(seedText));
  const bars = Array.from({ length: BARS }, (_, k) => ({
    base: 0.35 + 0.65 * (1 - k / BARS) * (0.6 + 0.4 * rand()), // bass bars sit higher
    freq: 1 + Math.floor(rand() * 3),
    phase: rand() * TAU,
  }));

  const frames: string[][] = [];
  const total = playing ? FRAMES : 1;
  for (let f = 0; f < total; f++) {
    const t = (f / FRAMES) * TAU;
    const kick = Math.max(0, Math.cos(t * 4)) ** 8; // 4 sharp "beats" per revolution
    const levels = bars.map((b, k) => {
      if (!playing) return 0.1;
      let v = b.base * (0.3 + 0.7 * Math.abs(Math.sin(t * b.freq + b.phase)));
      if (k < 5) v += kick * 0.35; // the kick only drives the low end
      return Math.min(1, v);
    });

    // Draw top-down. "__" marks a half-filled cell for finer vertical resolution.
    const rows: string[] = [];
    for (let line = BAR_H; line > 0; line--) {
      let row = "";
      for (const lv of levels) {
        const h = lv * BAR_H;
        row += (h >= line ? "##" : h >= line - 0.5 ? "__" : "  ") + " ";
      }
      rows.push(row.replace(/\s+$/, ""));
    }
    rows.push("=".repeat(BARS * 3 - 1)); // baseline
    frames.push(rows);
  }
  return frames;
}

// ── 3. SVG composition ───────────────────────────────────────────────────────

/** Converts text rows to positioned <text> elements, skipping blank rows to save bytes. */
function textRows(rows: string[], startLine: number, cls: string): string {
  return rows
    .map((r, idx) =>
      r.trim() === ""
        ? ""
        : `<text x="${PAD}" y="${PAD + (startLine + idx + 1) * LINE_H}" class="${cls}">${esc(r)}</text>`
    )
    .join("");
}

/**
 * Renders the full card for a track.
 * `null` means no data is available and renders a static "no data" card.
 */
export function renderSvg(track: Track | null): string {
  const playing = !!track?.nowPlaying;
  const seed = track ? `${track.artist} - ${track.name}` : "none";

  // Vertical layout, in text lines: vinyl, gap, spectrum, gap, info block.
  const specTop = H + 1;
  const specLines = BAR_H + 1;
  const infoTop = specTop + specLines + 1;
  const infoLines = 4;
  const totalLines = infoTop + infoLines;

  const width = Math.ceil(PAD * 2 + W * CHAR_W);
  const height = Math.ceil(PAD * 2 + totalLines * LINE_H);

  // Vinyl and spectrum advance together, one combined <g> per frame.
  const spec = spectrumFrames(seed, playing);
  const nFrames = playing ? FRAMES : 1;
  const dur = (FRAMES * FRAME_MS) / 1000;
  const step = FRAME_MS / 1000;

  let frames = "";
  for (let f = 0; f < nFrames; f++) {
    const rot = (f / FRAMES) * TAU;
    const content = textRows(vinylFrame(rot, playing), 0, "v") + textRows(spec[f], specTop, "s");
    if (playing) {
      // All frames share one animation. A negative delay offsets each into its own time slot,
      // and the negative start means the loop is already running at t = 0, with no blank first cycle.
      const delay = (f * step - dur).toFixed(3);
      frames += `<g class="f" style="animation-delay:${delay}s">${content}</g>`;
    } else {
      frames += `<g>${content}</g>`;
    }
  }

  let status: string, title: string, artist: string;
  if (!track) {
    status = LABELS.noData;
    title = "—";
    artist = "";
  } else {
    status = playing ? LABELS.nowPlaying : LABELS.silence(timeAgo(track.playedAt));
    title = truncate(track.name, MAX_TEXT);
    artist = truncate(track.artist, MAX_TEXT);
  }

  const y = (line: number) => PAD + (line + 1) * LINE_H;
  const indent = PAD + 3 * CHAR_W;
  const info =
    `<text x="${PAD}" y="${y(infoTop)}" class="${playing ? "live" : "m"}">${esc(status)}</text>` +
    `<text x="${indent}" y="${y(infoTop + 2)}" class="t">${esc(title)}</text>` +
    `<text x="${indent}" y="${y(infoTop + 3)}" class="m">${esc(artist)}</text>`;

  // `.f` frames are visible only for the first 1/FRAMES of each cycle. `step-end` makes the cut instant.
  const css = `
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:${FONT_SIZE}px;white-space:pre}
.v{fill:${COLORS.vinyl}}.s{fill:${COLORS.spectrum}}.t{fill:${COLORS.title};font-weight:bold}
.m{fill:${COLORS.muted}}.live{fill:${COLORS.live}}
.f{opacity:0;animation:fr ${dur}s step-end infinite}
@keyframes fr{0%{opacity:1}${(100 / FRAMES).toFixed(4)}%{opacity:0}100%{opacity:0}}`;

  const ariaLabel = track ? `${track.name} — ${track.artist}` : LABELS.noTrackAlt;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(
    ariaLabel
  )}"><style>${css}</style><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${COLORS.bg}" stroke="${COLORS.border}"/><g xml:space="preserve">${frames}${info}</g></svg>`;
}
