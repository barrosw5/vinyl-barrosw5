# vinyl-now-playing

A spinning ASCII vinyl record for your GitHub profile README, showing what you're listening to right now (or what you played last), pulled live from Last.fm.

```
music player ──scrobble──▶ Last.fm ──REST──▶ Vercel function (/api/vinyl) ──SVG──▶ GitHub profile README
```

No client-side JavaScript, no image hosting, no cron jobs. Each time someone views your profile, the image is rendered on request.

---

## How it works

GitHub READMEs can't run scripts, but they do render images, and **SVG supports CSS animations**. This project relies on that:

1. **Fetch.** A Vercel serverless function calls Last.fm's `user.getRecentTracks` to get your latest scrobble and whether it is still playing.
2. **Rasterise.** It renders 48 frames of an ASCII record (one full revolution) together with a synthetic spectrum analyser. Each frame is a grid of characters computed with simple polar-coordinate maths.
3. **Animate.** Every frame becomes an SVG `<g>` of `<text>` rows. A single CSS `@keyframes` rule shows each group for 1/48 of the cycle, and each group gets a negative `animation-delay` to put it in its own time slot. The result plays like a flipbook, in pure CSS.
4. **Serve.** The SVG is returned with `Cache-Control: no-cache`, so GitHub's image proxy (camo) re-fetches it, and with a 30-second `Vercel-CDN-Cache-Control`, so traffic spikes don't reach Last.fm.

When the track is paused or finished, only one static frame is rendered and the card shows how long ago it was played. If Last.fm can't be reached, the endpoint still returns a valid "no data" card instead of a broken image.

### Rendering details

| Element | Technique |
|---|---|
| **Disc** | Each cell is mapped to normalised polar coordinates `(r, θ)`. Different x/y radii make an ellipse, which reads as slight perspective. `r` selects the zone: spindle, label, grooves or outside. |
| **Grooves** | `sin(r · 45)` makes concentric rings, mapped onto the brightness ramp `" .:-=+*#%@"`. |
| **Sheen** | A specular highlight `cos(θ + 0.8)⁶` that stays fixed in screen space, as on a real turntable. |
| **Motion cues** | Scratch lines and a label wedge are offset by the rotation angle, so they are what visibly spins. |
| **Spectrum** | There is no audio. The bars come from sine oscillators seeded from `hash(artist + title)`, so each song has its own stable "signature". Every oscillator completes a whole number of cycles per revolution, so the loop has no visible seam. Low bars also get a periodic kick. |

---

## Project structure

```
.
├── api/
│   └── vinyl.ts        # HTTP entry point (Vercel function): env, fetch, render, cache headers
├── lib/
│   ├── lastfm.ts       # Typed Last.fm client: one request with a timeout, mapped to a small Track type
│   └── render.ts       # Pure renderer: Track → animated SVG string. All visual configuration lives here
├── scripts/
│   └── preview.ts      # Writes sample SVGs locally (fixture tracks + optional live track)
├── .env.example        # Template for local credentials
├── package.json
└── tsconfig.json
```

Each layer has one job. `api/vinyl.ts` handles I/O and HTTP. `lib/lastfm.ts` knows about Last.fm's response format. `lib/render.ts` is pure and has no dependencies, so you can iterate on it entirely offline with `npm run preview`.

---

## Getting started

### Prerequisites

- Node.js 20+
- A [Last.fm](https://www.last.fm) account that your music player scrobbles to
- A Last.fm API key: create one at <https://www.last.fm/api/account/create> (leave the callback URL empty; only the **API key** is needed)
- A [Vercel](https://vercel.com) account (the free Hobby plan is enough)

### Run locally

```bash
npm install
cp .env.example .env      # then fill in LASTFM_USER and LASTFM_API_KEY
npm run preview
```

This writes the following files to the project root:

| File | Contents |
|---|---|
| `preview-playing.svg` | Fixture track, now playing (animated) |
| `preview-paused.svg` | Fixture track, played 17 minutes ago (static) |
| `preview-real.svg` | Your actual latest track (only if `.env` is set) |

Open them in a browser. Editor image previews often don't play SVG animations.

Other scripts:

```bash
npm run typecheck         # tsc --noEmit
```

### Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, go to **Add New → Project**, import the repository, and set **Framework Preset: Other**.
3. Add the environment variables `LASTFM_USER` and `LASTFM_API_KEY`.
4. Deploy, then open `https://<your-project>.vercel.app/api/vinyl` to check that the card renders.

After that, every push to `main` redeploys automatically.

### Embed in your profile README

Your profile README lives in a public repository named exactly like your username (`<username>/<username>`). Add:

```html
<p align="center">
  <a href="https://www.last.fm/user/<your-lastfm-user>">
    <img src="https://<your-project>.vercel.app/api/vinyl" alt="What I'm listening to" />
  </a>
</p>
```

---

## Configuration

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `LASTFM_USER` | yes | Last.fm username whose scrobbles are shown |
| `LASTFM_API_KEY` | yes | Last.fm API key |

### Customising the look

All visual settings are constants at the top of [`lib/render.ts`](lib/render.ts):

| Constant | Effect |
|---|---|
| `COLORS` | Palette (defaults match GitHub's dark theme) |
| `LABELS` | Text shown on the card (status line, relative time) |
| `FRAMES`, `FRAME_MS` | Smoothness and speed. Each frame adds about 2 KB, and 48 frames is about 100 KB |
| `SHADE` | Brightness ramp for the grooves, e.g. try `" ░▒▓█"` |
| `W`, `H` | Canvas size in characters (the tonearm coordinates assume `W = 64`) |
| `BARS`, `BAR_H` | Spectrum width and height |
| `CHAR_W` | Monospace glyph width in px. Adjust it if characters look misaligned |

The groove density is set by the `45` in `Math.sin(r * 45)` inside `vinylFrame`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Broken image on the profile | Open `/api/vinyl` directly. If it fails, check **Vercel → Project → Logs**. |
| Card says `no data from last.fm` | Env vars are missing or misspelt in Vercel. Fix them, then **Redeploy** (env changes only apply to new deployments). |
| Track doesn't update | GitHub may keep the image for a short time anyway. Wait a minute and hard-refresh. |
| `Last.fm responded with HTTP 403` | Invalid API key, or `.env` still contains placeholder values. |
| Characters misaligned | The viewer's system monospace font differs. Adjust `CHAR_W`. |

---

## Security

The API key is only read from environment variables. `.env` is git-ignored and should never be committed. In production the key lives in Vercel's encrypted environment settings.
