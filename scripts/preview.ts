/**
 * Local preview: renders sample SVGs to the project root.
 *
 *   npm run preview
 *
 * Always writes `preview-playing.svg` and `preview-paused.svg` from fixture
 * tracks. If LASTFM_USER and LASTFM_API_KEY are set (via `.env` or the shell),
 * also writes `preview-real.svg` from the live Last.fm API.
 *
 * Open the files in a browser: VS Code's image preview does not always animate SVG.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getLastTrack, type Track } from "../lib/lastfm";
import { renderSvg } from "../lib/render";

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

async function main(): Promise<void> {
  loadDotEnv();

  for (const [file, track] of Object.entries(FIXTURES)) {
    writeFileSync(file, renderSvg(track));
    console.log(`✔ ${file}`);
  }

  const { LASTFM_USER, LASTFM_API_KEY } = process.env;
  if (!LASTFM_USER || !LASTFM_API_KEY) {
    console.log("ℹ LASTFM_USER / LASTFM_API_KEY not set — skipping live preview.");
    return;
  }

  const track = await getLastTrack(LASTFM_USER, LASTFM_API_KEY);
  writeFileSync("preview-real.svg", renderSvg(track));
  console.log("✔ preview-real.svg", track);
}

main().catch((err: unknown) => {
  console.error("✖", err instanceof Error ? err.message : err);
  process.exit(1);
});
