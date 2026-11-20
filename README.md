# vinyl-now-playing

[![CI](https://github.com/barrosw5/vinyl-barrosw5/actions/workflows/ci.yml/badge.svg)](https://github.com/barrosw5/vinyl-barrosw5/actions/workflows/ci.yml)
[![Deployment check](https://github.com/barrosw5/vinyl-barrosw5/actions/workflows/deployment-check.yml/badge.svg)](https://github.com/barrosw5/vinyl-barrosw5/actions/workflows/deployment-check.yml)

An animated ASCII turntable for your GitHub profile README. It shows what you are listening to on Last.fm, and its spectrum analyser is driven by the song's actual audio.

```
                                                       (O)
                 --:...::::----==*#                     |
            =:..:===-:::::::-=+*#%%#*@#@               /
         -:.-==:*.:-====--==+*####*@#@@@##@           /
                          ···                     [=]
## ## __
## ## ## ## __ __ ##       __ ##
## ## ## ## ## ## ##       ## ##       __
## ## ## ## ## ## ## ## __ ## ## __ __ ##    ## __
==============================================================
>> now playing · 116 bpm
   Get Lucky
   Daft Punk
```

- **Live.** It is rendered on request from your latest Last.fm scrobble, with no cron jobs and no image hosting.
- **Real audio.** The bars come from a spectral analysis of a 30-second preview of the song, looped in time with the beat.
- **Tempo-aware.** The BPM comes from the Deezer catalogue or is detected from the audio. 17 of 20 benchmark songs were detected within ±4 BPM, and none were wrong (see [Accuracy](#accuracy)).
- **Fail-safe.** Every external dependency is optional. Each failure degrades to a simpler card and never to a broken image.
- **Zero client JavaScript.** It is a single self-contained SVG animated with pure CSS.

---

## Contents

- [How it works](#how-it-works)
- [Audio analysis](#audio-analysis)
- [Rendering](#rendering)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Testing](#testing)
- [CI and releases](#ci-and-releases)
- [Accuracy](#accuracy)
- [Performance](#performance)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

---

## How it works

GitHub READMEs can't run scripts, but they do render images, and **SVG supports CSS animations**. The whole design follows from that: compute everything on the server, then ship a single animated image.

```
                         ┌────────────── Vercel function: GET /api/vinyl ──────────────┐
 music player            │                                                             │
   │ scrobble            │  1. Last.fm ── latest track, now playing?                   │
   ▼                     │        │                                                    │
 Last.fm ◀───────────────┼────────┘ (if playing)                                       │
                         │  2. Deezer ── catalogue match ─▶ BPM (often missing)        │
 Deezer  ◀───────────────┼────────┘                   └──▶ 30 s MP3 preview            │
                         │  3. decode (WASM) ─▶ DSP ─▶ detected BPM + spectrum loop    │
                         │  4. render ─▶ 48-frame SVG flipbook                         │
                         └─────────────────────────────┬───────────────────────────────┘
                                                       ▼
                                         GitHub profile README <img>
```

1. **Fetch.** [`lib/lastfm.ts`](lib/lastfm.ts) reads your latest scrobble from Last.fm's `user.getRecentTracks`, including whether it is playing now.
2. **Match.** While a track is playing, [`lib/deezer.ts`](lib/deezer.ts) looks it up in Deezer's public catalogue, which needs no key. That gives a catalogue BPM, when Deezer has one, and the URL of a 30-second MP3 preview.
3. **Analyse.** [`lib/audio.ts`](lib/audio.ts) decodes the preview with a WebAssembly build of mpg123. [`lib/dsp.ts`](lib/dsp.ts) then detects the tempo and computes a beat-aligned spectrum loop (see [Audio analysis](#audio-analysis)).
4. **Render.** [`lib/render.ts`](lib/render.ts) rasterises 48 frames of an ASCII record and spectrum, and packs them into one SVG. A CSS keyframe shows one frame at a time, like a flipbook.
5. **Serve.** [`api/vinyl.ts`](api/vinyl.ts) sends `Cache-Control: no-cache`, so GitHub's image proxy (camo) always re-fetches, and `Vercel-CDN-Cache-Control: max-age=30`, so traffic spikes are absorbed at the edge.

### Degradation

Every external call is optional. Failures are logged and handled by falling back to a simpler card:

| Situation | Card shows |
|---|---|
| Everything available | Real spectrum, tempo in the status line |
| Deezer has no BPM | Real spectrum, **detected** tempo |
| No steady pulse detected (ambient, rubato) | Real spectrum, no tempo |
| Track not on Deezer / preview unavailable / timeout | Synthetic, track-seeded spectrum |
| Nothing playing | Static frame, tonearm parked, `silence · last played 17 min ago` |
| Last.fm unreachable or misconfigured | `no data from last.fm` |

---

## Audio analysis

The analysis uses standard music-information-retrieval methods, chosen for robustness rather than novelty. Everything is implemented from scratch in [`lib/dsp.ts`](lib/dsp.ts) as pure functions, without dependencies.

```
MP3 ─▶ PCM 44.1 kHz ─▶ mono ─▶ decimate ÷2 (22.05 kHz) ─▶ STFT (Hann 2048 / hop 256)
                                                              │
                     ┌────────────────────────────────────────┴───────────────────┐
                     ▼                                                            ▼
          log spectral flux ─▶ smoothing                            21 log-spaced bands, dB
                     │                                                            │
           autocorrelation × tempo prior ─▶ BPM ─▶ beat phase ─▶ busiest N-beat excerpt
                                                                                  │
                                                     peak-hold per frame ─▶ normalise ─▶ release
                                                                                  ▼
                                                                         48 × 21 levels ∈ [0, 1]
```

### Tempo detection

1. **Onset envelope.** This is a measure of how much new energy appears in each 11.6 ms frame. It uses log-compressed spectral flux (Bello et al., 2005): the sum of positive changes in `log(1 + 100·|X|)` across all bins. The log compression lets quiet hi-hats register next to loud kicks. A 0.5 s moving average is subtracted so that only sudden increases remain.
2. **Periodicity.** The envelope is smoothed with a short Hann kernel, then autocorrelated over beat periods of 60–200 BPM. Each candidate period is scored as `r(τ) + ½·r(2τ)`, because a true beat also repeats at twice its period. The score is weighted by a log-normal prior centred on 120 BPM with a one-octave spread (Ellis, 2007). Parabolic interpolation refines the period to below one frame.
3. **Confidence gate.** The normalised autocorrelation at the chosen period is a confidence score. On 30 s previews, white noise scores 0.03–0.11, beat-driven music 0.5–0.85, and ambient or rubato pieces about 0.1. Estimates below **0.2** are discarded.

> **Why the smoothing matters.** Onset peaks are only one or two frames wide, while the beat period is rarely a whole number of frames (150 BPM is 34.45 frames). At integer lags the peaks drift apart, and the autocorrelation favours twice the period, where the rounding error is relatively smaller. Without the smoothing, a 150 BPM click track was detected as 75 BPM. The unit tests cover this.

**Source priority:** a catalogue BPM from Deezer, if there is one, otherwise the detected BPM, otherwise none.

### Spectrum loop

The visualiser shows the actual audio, not a simulation:

1. **Beat grid.** The beat phase is the offset that maximises onset strength summed over the beat grid.
2. **Excerpt.** The excerpt starts on a beat and spans exactly `beatsPerLoop(bpm)` beats. Of all such excerpts, it takes the one with the most onset activity, usually a chorus or drop rather than an intro. The excerpt is time-stretched to the fixed 3.84 s loop, so the loop seam lands on a downbeat.
3. **Bands.** There are 21 log-spaced bands from 50 Hz to 10 kHz, in dB. A +3 dB/octave tilt around 1 kHz compensates for music's natural high-frequency roll-off, as hardware analysers do.
4. **Peak-hold.** Each output frame takes the per-band maximum over its 80 ms slot, so short transients between samples are not lost.
5. **Normalisation.** Levels are normalised to a 30 dB window below the excerpt's 98th percentile, so quiet and loud masters both fill the display.
6. **Ballistics.** The bars have instant attack and a release of 15% of full height per frame, applied cyclically so the loop stays seamless.

Without a usable tempo, the busiest 3.84 s of audio is used as is.

---

## Rendering

### Animation timing

[`lib/animation.ts`](lib/animation.ts) defines the timing that both the renderer and the analyser must respect. Each loop is 48 frames of 80 ms, so **3.84 s per revolution**.

A seamless loop needs a whole number of beats per revolution. Tempos are therefore folded into 70–160 BPM by octaves (220 → 110), and the beat count is rounded: `round(bpm × 3.84 / 60)`. The displayed pulse is quantised to steps of about 15.6 BPM, which is within ±8 BPM of the real tempo. The eye can't tell that difference at this frame rate.

### The flipbook

Each frame becomes an SVG `<g>` of `<text>` rows. All frames share one CSS animation, `@keyframes fr { 0% { opacity: 1 } 2.08% { opacity: 0 } }`, which uses `step-end` timing. Each frame gets a negative `animation-delay` that puts it in its own 80 ms slot. Because the delays are negative, the loop is already running when the image first paints.

### The record

| Element | Technique |
|---|---|
| **Disc** | Each character cell is mapped to normalised polar coordinates `(r, θ)`. Unequal x/y radii make an ellipse, which reads as slight perspective. `r` selects the zone: spindle, label, grooves or outside. |
| **Grooves** | `sin(45·r)` makes concentric rings, shaded through the brightness ramp `" .:-=+*#%@"`. |
| **Sheen** | A specular highlight `max(0, cos(θ + 0.8))⁶` that stays fixed in screen space, as on a real turntable. |
| **Motion cues** | Scratch lines and a label wedge are offset by the rotation angle, so they are what visibly spins. |
| **Tonearm** | Two sprites of `[row, col, char]` cells: lowered onto the grooves while playing, parked on its rest clip when idle. |
| **Fallback spectrum** | Sine oscillators seeded from `hash(artist + title)` (FNV-1a + mulberry32), so each song gets a stable "signature". A kick follows the tempo, if one is known. |

The SVG is about 105 KB. Text is XML-escaped, and malformed spectrum input is rejected so it can't corrupt the card.

---

## Project structure

```
.
├── api/
│   └── vinyl.ts          HTTP entry point: env, orchestration, cache headers
├── lib/
│   ├── lastfm.ts         Last.fm client (typed, with a timeout)
│   ├── deezer.ts         Deezer catalogue client and title matching
│   ├── features.ts       Audio feature orchestration: time budget, memoisation, graceful degradation
│   ├── audio.ts          MP3 decoding (WASM) and the analysis pipeline → tempo + spectrum loop
│   ├── dsp.ts            Pure DSP: FFT, STFT, onset envelope, tempo estimation, band levels
│   ├── animation.ts      Timing shared by the renderer and the analyser (frames, bars, tempo folding)
│   └── render.ts         Pure renderer: track + features → animated SVG
├── public/
│   └── index.html        Landing page at / (the card, plus credits)
├── scripts/
│   ├── preview.ts        Renders SVGs locally (fixtures, your live track, or any track)
│   └── smoke.mjs         Loads the compiled build with plain Node, as Vercel does
├── tests/                Unit tests on synthetic audio (node:test, no network)
└── .github/
    ├── workflows/ci.yml                 Typecheck, tests and smoke test on Node 20 / 22 / 24
    ├── workflows/deployment-check.yml   Health check of every deployment, plus production every 6 h
    └── dependabot.yml                   Weekly dependency update PRs
```

**Dependency direction.** `api → features → (deezer, audio → dsp)` and `api → render`. `animation` is the only module shared by both branches. `dsp` and `render` are pure: they do no I/O and don't read the clock, apart from `timeAgo`. All network access sits behind `lastfm.ts` and `features.ts`, and the endpoint handles their failures in one place each.

**Runtime dependencies:** one, [`mpg123-decoder`](https://github.com/eshaz/wasm-audio-decoders) (MIT). It is WebAssembly with no native binaries, so it runs unchanged on Vercel. It is loaded lazily, with a dynamic `import()` on first use. If it can't be loaded in some runtime, only the audio enrichment fails and the endpoint keeps serving cards.

---

## Getting started

### Prerequisites

- **Node.js 20+**. The project is native ES modules (`"type": "module"`).
- A [Last.fm](https://www.last.fm) account that your music player scrobbles to.
- A **Last.fm API key**. Create one at <https://www.last.fm/api/account/create> and leave the callback URL empty. Only the *API key* is needed.
- A [Vercel](https://vercel.com) account. The free Hobby plan is enough.

### Run locally

```bash
npm install
cp .env.example .env                       # fill in LASTFM_USER and LASTFM_API_KEY
npm run preview                            # fixtures + your latest scrobble
npm run preview -- "Daft Punk" "Get Lucky" # any track, as if now playing
```

| Output | Contents |
|---|---|
| `preview-playing.svg` / `preview-paused.svg` | Fixture track, playing and idle (offline) |
| `preview-bpm.svg` | Fixture, synthetic spectrum at 128 BPM (offline) |
| `preview-real.svg` | Your latest scrobble, through the full pipeline |
| `preview-track.svg` | The track given on the command line |

The console reports the pipeline outcome for each track, for example `116 BPM (catalogue), real spectrum [1375 ms]`. Open the files in a browser, because editor image previews often don't play SVG animations.

### Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel, go to **Add New → Project**, import the repository, and set **Framework Preset: Other**.
3. Add the environment variables `LASTFM_USER` and `LASTFM_API_KEY`.
4. Deploy, then open `https://<your-project>.vercel.app/api/vinyl`.

Every push to `main` redeploys automatically. Changes to environment variables only take effect after a redeploy.

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

The Deezer lookup needs no credentials.

### Tuning

Each constant is documented at its definition:

| Where | Constant | Effect |
|---|---|---|
| `animation.ts` | `FRAMES`, `FRAME_MS` | Loop length and smoothness. Each frame adds about 2 KB to the SVG |
| `animation.ts` | `BARS`, `MIN_BPM`, `MAX_BPM` | Spectrum resolution and the tempo folding range |
| `render.ts` | `COLORS`, `LABELS` | Palette (GitHub dark by default) and card text |
| `render.ts` | `SHADE`, `W`, `H`, `CHAR_W` | Groove shading, canvas size, glyph width (tonearm sprites assume `W = 64`) |
| `render.ts` | `TONEARM_PLAYING`, `TONEARM_RESTING` | The two tonearm poses |
| `audio.ts` | `BAND_MIN_HZ`, `BAND_MAX_HZ` | Frequency range of the bars |
| `audio.ts` | `DISPLAY_RANGE_DB`, `RELEASE_PER_FRAME` | Bar dynamics: contrast and fall speed |
| `dsp.ts` | `minConfidence` | How sure the tempo detector must be to report a BPM |
| `features.ts` | `LOOKUP_TIMEOUT_MS` | Network budget for the audio feature lookup |

---

## Testing

```bash
npm test          # 36 unit tests, about 1.5 s, no network
npm run typecheck # tsc --noEmit
npm run smoke     # build to dist/ and load it with plain Node, as Vercel does
npm run check     # all of the above (what CI runs)
```

The tests use **synthetic audio** generated from a seed (click tracks, sines and white noise), so they are deterministic and run offline. They cover:

- **DSP:** FFT correctness, tempo detection on 80–150 BPM click tracks (±1 BPM), rejection of noise and of too-short input, beat-phase location, band placement of tones, the spectral tilt.
- **Analysis:** the spectrum loop's shape and range, and that bars are louder on the beat than between beats. Also the fallbacks: with no tempo, and with input too short for one loop.
- **Rendering:** frame count, the idle state, the tempo label, XML escaping, real and malformed spectrum input.
- **Matching:** title clean-up (`feat.`, remasters, live tags) and Unicode-aware name comparison.

The **smoke test** ([`scripts/smoke.mjs`](scripts/smoke.mjs)) covers what unit tests can't. `tsx` transparently bridges module formats, so a build can pass every unit test and still fail to load in production. For example, a CommonJS build that `require()`s an ES-module dependency crashes with `ERR_REQUIRE_ESM` on Node < 22.12. The smoke test compiles the project, loads it with plain Node, calls the handler, and loads the WASM decoder.

---

## CI and releases

Production must never break silently, so changes reach `main` only through checks:

| Layer | When | What it guarantees |
|---|---|---|
| **CI** ([`ci.yml`](.github/workflows/ci.yml)) | Every PR and every push to `main` | Typecheck, unit tests and smoke test pass on **Node 20, 22 and 24**, every runtime the code may meet |
| **Vercel preview** | Every PR | The exact change is deployed to its own URL before it reaches production |
| **Deployment check** ([`deployment-check.yml`](.github/workflows/deployment-check.yml)) | After every successful deployment | `/api/vinyl` answers `200 image/svg+xml` with a valid card, and production also has working Last.fm credentials |
| **Scheduled check** | Every 6 hours, against production | Catches breakage from outside the repo: revoked keys, upstream API changes |
| **Dependabot** ([`dependabot.yml`](.github/dependabot.yml)) | Weekly | Dependency updates arrive as PRs and go through all of the above |
| **Branch ruleset** on `main` | Always | No direct pushes or force pushes. Merging requires the CI checks to pass |

**Workflow:**

```bash
git switch -c my-change          # work on a branch, never on main
npm run check                    # same checks as CI, locally
git push -u origin my-change     # then open a pull request on GitHub
```

Wait for the checks and the Vercel preview, open the preview's `/api/vinyl` if the change is visual, then merge. Vercel deploys `main` to production, and the deployment check verifies it.

> If Vercel *Deployment Protection* is enabled for previews, the deployment check can't reach them and reports a warning instead of failing. To check previews too, create a bypass token under **Vercel → Settings → Deployment Protection → Protection Bypass for Automation** and save it as the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`.

---

## Accuracy

The tempo detector, run on 30-second Deezer previews of 20 well-known songs from different genres and eras, compared against published tempos:

| Outcome | Songs |
|---|---|
| Within ±4 BPM | **17** |
| Half the reference tempo (e.g. 76.5 for *Weird Fishes*, 153) | 2 |
| Rejected as low confidence (*Take On Me*: Deezer's catalogue BPM is used) | 1 |
| **Wrong** | **0** |

The half-tempo results are *octave errors*, the classic ambiguity in tempo estimation: humans also disagree on whether a song is 80 or 160 BPM. They don't affect the visualiser, because 5 beats at 76.5 BPM last exactly as long as 10 beats at 153 BPM. Only the number in the status line differs.

For six of the twenty songs, Deezer's catalogue had no BPM at all, and detection was correct for every one of them.

---

## Performance

Measured locally on a desktop. Vercel's network is typically faster, and its CPU slower.

| Step | Time |
|---|---|
| Deezer search + track lookup | ~150–300 ms |
| Preview download (~480 KB) | ~400–800 ms |
| MP3 decode (WASM) | ~70 ms |
| Analysis (STFT, tempo, spectrum loop) | ~265 ms median |
| **First view of a new song** | **~1–2 s** |
| Later views on a warm instance | ~Last.fm round-trip only (memoised) |

Optimisations: the FFT uses twiddle-factor tables computed once per size, and the audio is decimated to 22.05 kHz before analysis. Results are memoised per instance (at most 200 songs, under 1 MB), and the shared CDN cache is 30 s. The network budget is capped at 4 s, and if it runs out the card falls back gracefully.

---

## Limitations

- **Coverage depends on Deezer.** Tracks that aren't on Deezer, or that Deezer offers no preview for, get the synthetic spectrum.
- **It is an excerpt, not playback sync.** The bars show a real ~4-second section of the song, but not the moment you're currently hearing. The card has no access to playback position, and a static image couldn't follow it anyway.
- **Tempo is a single value.** Songs with tempo changes are summarised by their dominant pulse in the preview.
- **Matching is heuristic.** Artist names must match after normalisation. Remixes or alternative artist spellings can miss, or match a different version.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Broken image on the profile | Open `/api/vinyl` directly. If it fails, check **Vercel → Project → Logs**. |
| `no data from last.fm` | Env vars missing or misspelt in Vercel. Fix them, then **Redeploy**. |
| Track doesn't update | GitHub may keep the image for a short while. Wait a minute and hard-refresh. |
| `Last.fm responded with HTTP 403` | Invalid API key, or `.env` still holds placeholder values. |
| No `· bpm` in the status line | No catalogue BPM and no confident detection, which is expected for ambient or rubato music. Run `npm run preview -- "<artist>" "<title>"` to see the pipeline result. |
| Synthetic-looking bars | The track wasn't matched on Deezer. Look for `Deezer lookup failed` or `Preview analysis failed` in the Vercel logs. |
| Characters misaligned | The viewer's monospace font differs. Adjust `CHAR_W`. |

---

## Security

The Last.fm API key is only read from environment variables. `.env` is git-ignored, and in production the key lives in Vercel's encrypted settings. Track metadata is XML-escaped before it is embedded in the SVG. Preview downloads are capped at 2 MB and bounded by the request time budget.

---

## Credits

- Listening data: [Last.fm](https://www.last.fm).
- Audio previews and catalogue tempo: [Deezer](https://www.deezer.com).
- MP3 decoding: [mpg123-decoder](https://github.com/eshaz/wasm-audio-decoders) (MIT), a WebAssembly build of [mpg123](https://www.mpg123.de).
- Methods: J. P. Bello et al., *A Tutorial on Onset Detection in Music Signals*, IEEE TSAP, 2005. D. P. W. Ellis, *Beat Tracking by Dynamic Programming*, JNMR, 2007.
