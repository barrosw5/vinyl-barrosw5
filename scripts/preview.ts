// ─────────────────────────────────────────────────────────────
//  preview.ts — gera SVGs de teste no teu PC
//  Corre com:  npm run preview
//  Sem .env usa músicas inventadas; com .env usa o teu Last.fm a sério.
// ─────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { renderSvg } from "../lib/render";
import { getLastTrack } from "../lib/lastfm";

// Lê o ficheiro .env (se existir) sem precisar de bibliotecas
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  writeFileSync(
    "preview-playing.svg",
    renderSvg({ name: "Nome da Música", artist: "Artista Qualquer", nowPlaying: true })
  );
  writeFileSync(
    "preview-paused.svg",
    renderSvg({
      name: "Outra Faixa",
      artist: "Banda Fixe",
      nowPlaying: false,
      playedAt: Math.floor(Date.now() / 1000) - 17 * 60,
    })
  );
  console.log("✔ preview-playing.svg e preview-paused.svg criados");

  const { LASTFM_USER, LASTFM_API_KEY } = process.env;
  if (LASTFM_USER && LASTFM_API_KEY) {
    const track = await getLastTrack(LASTFM_USER, LASTFM_API_KEY);
    writeFileSync("preview-real.svg", renderSvg(track));
    console.log("✔ preview-real.svg criado com a tua última música:", track);
  } else {
    console.log("ℹ Sem .env — salta o teste com o Last.fm a sério.");
  }
}

main().catch((e) => {
  console.error("✖ Erro:", e.message);
  process.exit(1);
});
