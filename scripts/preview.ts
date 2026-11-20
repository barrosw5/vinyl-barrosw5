/**
 * Local preview: renders sample SVGs to the project root.
 *
 *   npm run preview                          # fixtures + your live Last.fm track
 *   npm run preview -- "Daft Punk" "Get Lucky"   # analyse any track, as if now playing
 *
 * Always writes `preview-playing.svg`, `preview-paused.svg` and `preview-bpm.svg`
 * from fixture tracks (offline). Then:
 * - with an artist and title as arguments, writes `preview-track.svg` for that track;
 * - otherwise, if LASTFM_USER and LASTFM_API_KEY are set (via `.env` or the shell),
 *   writes `preview-real.svg` for your latest scrobble.
 * Both go through the same audio feature pipeline as the endpoint.
 *
 * Open the files in a browser: VS Code's image preview does not always animate SVG.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getAudioFeatures, type AudioFeatures } from "../lib/features.js";
import { getLastTrack, type Track } from "../lib/lastfm.js";
import { renderSvg } from "../lib/render.js";

const FIXTURES: Record<string, Track> = {
  "preview-playing.svg": { name: "Song Title", artist: "Some Artist", nowPlaying: true },
  "preview-paused.svg": {
    name: "Another Track",
    artist: "Some Band",
    nowPlaying: false,
    playedAt: Math.floor(Date.now() / 1000) - 17 * 60,
  },
};

/**
 * Minimal `.env` loader (KEY=value per line, optional quotes), so the script
 * has no runtime dependencies. Existing environment variables take precedence.
 */
function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    process.env[key] ??= value.replace(/^["']|["']$/g, "");
  }
}

function describe(features: AudioFeatures | null): string {
  if (!features) return "not found on Deezer → synthetic spectrum, no BPM";
  const bpm = features.bpm ? `${Math.round(features.bpm)} BPM (${features.bpmSource})` : "no BPM";
  const spectrum = features.spectrum ? "real spectrum" : "synthetic spectrum";
  return `${bpm}, ${spectrum}`;
}

/** Renders a track as if it were playing, through the full audio feature pipeline. */
async function renderLive(file: string, track: Track): Promise<void> {
  const started = performance.now();
  const features = await getAudioFeatures(track.name, track.artist);
  const ms = Math.round(performance.now() - started);
  writeFileSync(file, renderSvg({ ...track, nowPlaying: true }, { bpm: features?.bpm, spectrum: features?.spectrum }));
  console.log(`✔ ${file}  ${track.artist} – ${track.name}: ${describe(features)} [${ms} ms]`);
}

async function main(): Promise<void> {
  loadDotEnv();

  for (const [file, track] of Object.entries(FIXTURES)) {
    writeFileSync(file, renderSvg(track));
    console.log(`✔ ${file}`);
  }
  writeFileSync("preview-bpm.svg", renderSvg(FIXTURES["preview-playing.svg"], { bpm: 128 }));
  console.log("✔ preview-bpm.svg (fixture, synthetic spectrum at 128 BPM)");

  const [artist, title] = process.argv.slice(2);
  if (artist && title) {
    await renderLive("preview-track.svg", { artist, name: title, nowPlaying: true });
    return;
  }

  const { LASTFM_USER, LASTFM_API_KEY } = process.env;
  if (!LASTFM_USER || !LASTFM_API_KEY) {
    console.log("ℹ LASTFM_USER / LASTFM_API_KEY not set — skipping live preview.");
    return;
  }

  const track = await getLastTrack(LASTFM_USER, LASTFM_API_KEY);
  if (!track) {
    console.log("ℹ No scrobbles found on Last.fm.");
    return;
  }
  // Unlike the endpoint, analyse even when paused, so the pipeline can be tested at any time.
  await renderLive("preview-real.svg", track);
}

main().catch((err: unknown) => {
  console.error("✖", err instanceof Error ? err.message : err);
  process.exit(1);
});
