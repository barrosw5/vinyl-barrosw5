// ─────────────────────────────────────────────────────────────
//  lastfm.ts — vai buscar a última música ao Last.fm
// ─────────────────────────────────────────────────────────────

export type Track = {
  name: string;
  artist: string;
  album?: string;
  nowPlaying: boolean; // true = está a tocar neste momento
  playedAt?: number;   // quando foi ouvida (segundos desde 1970), se já acabou
};

export async function getLastTrack(user: string, apiKey: string): Promise<Track | null> {
  const url =
    "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks" +
    `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(apiKey)}` +
    "&limit=1&format=json";

  const res = await fetch(url, { headers: { "User-Agent": "vinyl-now-playing" } });
  if (!res.ok) throw new Error(`Last.fm respondeu ${res.status}`);

  const data: any = await res.json();
  if (data.error) throw new Error(`Last.fm: ${data.message}`);

  // O Last.fm às vezes devolve uma lista, às vezes um objeto só
  const list = data?.recenttracks?.track;
  const t = Array.isArray(list) ? list[0] : list;
  if (!t) return null;

  return {
    name: t.name,
    artist: t.artist?.["#text"] ?? t.artist?.name ?? "Desconhecido",
    album: t.album?.["#text"] || undefined,
    nowPlaying: t["@attr"]?.nowplaying === "true",
    playedAt: t.date?.uts ? Number(t.date.uts) : undefined,
  };
}
