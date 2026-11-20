/**
 * GET /api/vinyl
 *
 * Vercel serverless function that returns an animated SVG of the user's
 * latest Last.fm track. Embedded as an <img> in a GitHub profile README.
 *
 * Always responds 200 with a valid SVG: if Last.fm is unreachable or the
 * environment is misconfigured, a "no data" card is rendered instead of a
 * broken image, and the cause is written to the function logs.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getLastTrack, type Track } from "../lib/lastfm";
import { renderSvg } from "../lib/render";

/** How long Vercel's edge may reuse a response, to avoid hitting Last.fm on every view. */
const CDN_MAX_AGE_SECONDS = 30;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const user = process.env.LASTFM_USER;
  const apiKey = process.env.LASTFM_API_KEY;

  let track: Track | null = null;
  if (!user || !apiKey) {
    console.error("Missing LASTFM_USER and/or LASTFM_API_KEY environment variables");
  } else {
    try {
      track = await getLastTrack(user, apiKey);
    } catch (err) {
      console.error("Failed to fetch latest track from Last.fm:", err);
    }
  }

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // Browsers and GitHub's image proxy (camo) must not cache, or the track would go stale.
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
  // Vercel's CDN reads this header instead and may serve a short-lived shared copy.
  res.setHeader("Vercel-CDN-Cache-Control", `max-age=${CDN_MAX_AGE_SECONDS}`);
  res.status(200).send(renderSvg(track));
}
