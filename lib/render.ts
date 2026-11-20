// ─────────────────────────────────────────────────────────────
//  render.ts — desenha o vinil em ASCII e transforma em SVG animado
// ─────────────────────────────────────────────────────────────
import type { Track } from "./lastfm";

// ── Configuração (mexe à vontade) ────────────────────────────
const W = 64;            // largura do desenho do vinil (em caracteres)
const H = 19;            // altura do desenho do vinil (em linhas)
const FRAMES = 48;       // nº de frames numa volta completa do disco
const FRAME_MS = 80;     // duração de cada frame (ms) → 48 × 80ms ≈ 3,8s por volta
const BARS = 21;         // nº de barras do espectro
const BAR_H = 6;         // altura máxima das barras (linhas)
const SHADE = " .:-=+*#%@"; // do mais escuro para o mais claro

const FONT_SIZE = 12;
const LINE_H = 14;       // espaço entre linhas (px)
const CHAR_W = 7.25;     // largura aproximada de um caractere monoespaçado (px)
const PAD = 20;

const COLORS = {
  bg: "#0d1117",
  border: "#30363d",
  vinyl: "#c9d1d9",
  spectrum: "#00d4ff",
  title: "#ffffff",
  muted: "#8b949e",
  live: "#3fb950",
};

// ── Utilitários ──────────────────────────────────────────────

// Transforma uma string num número (sempre o mesmo para a mesma string).
// Serve para cada música ter sempre o mesmo "padrão" no espectro.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Gerador de números pseudo-aleatórios com seed (mulberry32).
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Caracteres especiais (&, <, >) partem o SVG se não forem "escapados".
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

function timeAgo(unixSeconds?: number): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 60) return "agora mesmo";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return `há ${Math.floor(diff / 86400)} dias`;
}

// ── 1) O vinil ───────────────────────────────────────────────
// Para cada "pixel" (caractere) da grelha, calculamos:
//   - a distância ao centro (r)  → decide se é rótulo, sulcos ou fora do disco
//   - o ângulo (ang)             → serve para a rotação e o reflexo de luz
// O disco é desenhado como uma elipse, o que dá o efeito de perspetiva.
function vinylFrame(rotation: number): string[] {
  const cx = W * 0.4;
  const cy = (H - 1) / 2 + 0.31; // desvio pequeno para os riscos não alinharem com uma linha inteira
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
        c = "o"; // furo do centro
      } else if (r < 0.32) {
        // Rótulo: tem uma "fatia" marcada que roda com o disco
        const a = (((ang - rotation) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        c = a < 0.9 ? "#" : r < 0.2 ? "=" : "-";
      } else if (r < 1) {
        // Sulcos: anéis concêntricos (seno da distância)
        const groove = 0.5 + 0.5 * Math.sin(r * 45);
        // Reflexo de luz: fixo, NÃO roda (como num disco a sério)
        const sheen = Math.max(0, Math.cos(ang + 0.8)) ** 6;
        // Riscos: rodam com o disco, é o que mostra que está a girar
        const scratch = Math.abs(Math.sin((ang - rotation) * 3)) < 0.05 ? 0.5 : 0;
        const v = Math.min(0.99, 0.15 + groove * 0.3 + sheen * 0.6 + scratch);
        c = SHADE[Math.floor(v * SHADE.length)];
      }
      row.push(c);
    }
    grid.push(row);
  }

  // Braço do gira-discos (desenhado por cima)
  const arm: [number, number, string][] = [
    [0, 55, "("], [0, 56, "O"], [0, 57, ")"],
    [1, 56, "|"], [2, 55, "/"], [3, 54, "/"], [4, 53, "/"], [5, 52, "/"],
    [6, 51, "/"], [7, 50, "/"], [8, 49, "/"], [9, 48, "/"], [10, 47, "/"],
    [11, 44, "["], [11, 45, "="], [11, 46, "]"],
  ];
  for (const [j, i, ch] of arm) if (grid[j] && i < W) grid[j][i] = ch;

  return grid.map((r) => r.join("").replace(/\s+$/, ""));
}

// ── 2) O espectro ────────────────────────────────────────────
// Não temos o áudio, por isso o espectro é "falso" mas consistente:
// usamos o nome da música como seed. Todas as ondas têm períodos que
// cabem certinhos em FRAMES, por isso a animação dá a volta sem saltos.
function spectrumFrames(seedText: string, playing: boolean): string[][] {
  const rand = rng(hash(seedText));
  const bars = Array.from({ length: BARS }, (_, k) => ({
    base: 0.35 + 0.65 * (1 - k / BARS) * (0.6 + 0.4 * rand()), // graves mais altos
    freq: 1 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
  }));

  const frames: string[][] = [];
  const total = playing ? FRAMES : 1;
  for (let f = 0; f < total; f++) {
    const t = (f / FRAMES) * Math.PI * 2;
    const kick = Math.max(0, Math.cos(t * 4)) ** 8; // "batida" 4× por volta
    const levels = bars.map((b, k) => {
      if (!playing) return 0.1; // parado: barras "deitadas"
      let v = b.base * (0.3 + 0.7 * Math.abs(Math.sin(t * b.freq + b.phase)));
      if (k < 5) v += kick * 0.35;
      return Math.min(1, v);
    });

    const rows: string[] = [];
    for (let line = BAR_H; line > 0; line--) {
      let row = "";
      for (const lv of levels) {
        const h = lv * BAR_H;
        row += (h >= line ? "##" : h >= line - 0.5 ? "__" : "  ") + " ";
      }
      rows.push(row.replace(/\s+$/, ""));
    }
    rows.push("=".repeat(BARS * 3 - 1));
    frames.push(rows);
  }
  return frames;
}

// ── 3) Juntar tudo num SVG ───────────────────────────────────
function textRows(rows: string[], startLine: number, cls: string): string {
  return rows
    .map((r, idx) =>
      r.trim() === ""
        ? ""
        : `<text x="${PAD}" y="${PAD + (startLine + idx + 1) * LINE_H}" class="${cls}">${esc(r)}</text>`
    )
    .join("");
}

export function renderSvg(track: Track | null): string {
  const playing = !!track?.nowPlaying;
  const seed = track ? `${track.artist} - ${track.name}` : "nada";

  const vinylLines = H;
  const specTop = vinylLines + 1;
  const specLines = BAR_H + 1;
  const infoTop = specTop + specLines + 1;
  const infoLines = 4;
  const totalLines = infoTop + infoLines;

  const width = Math.ceil(PAD * 2 + W * CHAR_W);
  const height = Math.ceil(PAD * 2 + totalLines * LINE_H);

  // Frames animados (vinil + espectro mudam juntos)
  const spec = spectrumFrames(seed, playing);
  const nFrames = playing ? FRAMES : 1;
  const dur = (FRAMES * FRAME_MS) / 1000;
  const step = FRAME_MS / 1000;

  let frames = "";
  for (let f = 0; f < nFrames; f++) {
    const rot = (f / FRAMES) * Math.PI * 2;
    const content =
      textRows(vinylFrame(rot), 0, "v") + textRows(spec[f], specTop, "s");
    if (playing) {
      // Cada frame fica visível só durante a sua "fatia" de tempo
      const delay = (f * step - dur).toFixed(3);
      frames += `<g class="f" style="animation-delay:${delay}s">${content}</g>`;
    } else {
      frames += `<g>${content}</g>`;
    }
  }

  // Texto da música
  let status: string, title: string, artist: string;
  if (!track) {
    status = ">> sem dados do last.fm";
    title = "—";
    artist = "";
  } else {
    status = playing ? ">> a ouvir agora" : `>> ouvido por último · ${timeAgo(track.playedAt)}`;
    title = truncate(track.name, 52);
    artist = truncate(track.artist, 52);
  }

  const y = (line: number) => PAD + (line + 1) * LINE_H;
  const info =
    `<text x="${PAD}" y="${y(infoTop)}" class="${playing ? "live" : "m"}">${esc(status)}</text>` +
    `<text x="${PAD + 3 * CHAR_W}" y="${y(infoTop + 2)}" class="t">${esc(title)}</text>` +
    `<text x="${PAD + 3 * CHAR_W}" y="${y(infoTop + 3)}" class="m">${esc(artist)}</text>`;

  const css = `
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:${FONT_SIZE}px;white-space:pre}
.v{fill:${COLORS.vinyl}}.s{fill:${COLORS.spectrum}}.t{fill:${COLORS.title};font-weight:bold}
.m{fill:${COLORS.muted}}.live{fill:${COLORS.live}}
.f{opacity:0;animation:fr ${dur}s step-end infinite}
@keyframes fr{0%{opacity:1}${(100 / FRAMES).toFixed(4)}%{opacity:0}100%{opacity:0}}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(
    track ? `${track.name} — ${track.artist}` : "Sem música"
  )}"><style>${css}</style><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${COLORS.bg}" stroke="${COLORS.border}"/><g xml:space="preserve">${frames}${info}</g></svg>`;
}
