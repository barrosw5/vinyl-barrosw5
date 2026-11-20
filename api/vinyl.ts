// ─────────────────────────────────────────────────────────────
//  api/vinyl.ts — o endpoint que o README vai mostrar
//  No Vercel fica em:  https://<o-teu-projeto>.vercel.app/api/vinyl
// ─────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getLastTrack, type Track } from "../lib/lastfm";
import { renderSvg } from "../lib/render";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const user = process.env.LASTFM_USER;
  const key = process.env.LASTFM_API_KEY;

  let track: Track | null = null;
  if (user && key) {
    try {
      track = await getLastTrack(user, key);
    } catch (err) {
      console.error(err); // aparece nos logs do Vercel
    }
  } else {
    console.error("Faltam as variáveis LASTFM_USER e/ou LASTFM_API_KEY");
  }

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // Diz ao GitHub (e aos browsers) para não guardarem uma versão antiga
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
  // Mas o Vercel pode guardar 30s, para não chatear o Last.fm a cada visita
  res.setHeader("Vercel-CDN-Cache-Control", "max-age=30");
  res.status(200).send(renderSvg(track));
}
