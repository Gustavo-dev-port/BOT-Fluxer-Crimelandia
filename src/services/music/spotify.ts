/**
 * Spotify: só metadados. Faixas, álbuns e playlists viram buscas no YouTube
 * ("artista - música"), feitas quando chega a vez de cada uma.
 * Com SPOTIFY_CLIENT_ID/SECRET usa a Web API (álbuns e playlists); sem, só faixas (oEmbed).
 */
import { asArray, fetchJson, isObject, num, str } from '../../utils/http.js';
import type { Track } from './types.js';

export const MAX_SPOTIFY_ITEMS = 100;

export function parseSpotifyUrl(text: string): { type: 'track' | 'album' | 'playlist'; id: string } | null {
  const t = text.trim();
  const uri = /^spotify:(track|album|playlist):([A-Za-z0-9]+)$/.exec(t);
  if (uri) return { type: uri[1] as 'track' | 'album' | 'playlist', id: uri[2] };
  const url = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/i.exec(t);
  return url ? { type: url[1].toLowerCase() as 'track' | 'album' | 'playlist', id: url[2] } : null;
}

/** Item do Spotify: busca no YouTube pendente. */
export function spotifyItem(title: string, artist: string, durationMs: number | null, requestedById: string): Track {
  return {
    title,
    artist,
    durationSeconds: durationMs === null ? null : Math.round(durationMs / 1000),
    url: '',
    thumbnail: null,
    source: 'spotify',
    query: `${artist} - ${title}`,
    requestedById,
  };
}

/** Converte uma faixa da Web API do Spotify. */
export function parseSpotifyTrack(raw: unknown, requestedById: string): Track | null {
  if (!isObject(raw)) return null;
  const title = str(raw.name);
  if (!title) return null;
  const artists = asArray(raw.artists)
    .map((a) => (isObject(a) ? str(a.name) : null))
    .filter((a): a is string => Boolean(a));
  return spotifyItem(title, artists.join(', ') || 'Spotify', num(raw.duration_ms), requestedById);
}

export class SpotifyResolver {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly api = 'https://api.spotify.com/v1',
    private readonly accounts = 'https://accounts.spotify.com/api/token',
    private readonly oembed = 'https://open.spotify.com/oembed',
  ) {}

  get hasCredentials() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Token de aplicação (client credentials), renovado antes de vencer. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await fetch(this.accounts, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Spotify recusou as credenciais (HTTP ${res.status}). Confira SPOTIFY_CLIENT_ID/SECRET.`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Spotify não devolveu token.');
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async get(path: string): Promise<unknown> {
    return fetchJson(`${this.api}${path}`, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
  }

  async resolve(url: string, requestedById: string): Promise<{ title: string | null; tracks: Track[] }> {
    const ref = parseSpotifyUrl(url);
    if (!ref) return { title: null, tracks: [] };

    if (!this.hasCredentials) {
      if (ref.type !== 'track') {
        throw new Error('Álbuns e playlists do Spotify precisam de SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no .env.');
      }
      // Sem credenciais: o oEmbed traz só o nome da faixa.
      const raw = await fetchJson(`${this.oembed}?url=${encodeURIComponent(`https://open.spotify.com/track/${ref.id}`)}`);
      const title = isObject(raw) ? str(raw.title) : null;
      if (!title) return { title: null, tracks: [] };
      const item = spotifyItem(title, '', null, requestedById);
      return { title: null, tracks: [{ ...item, artist: 'Spotify', query: title }] };
    }

    if (ref.type === 'track') {
      const t = parseSpotifyTrack(await this.get(`/tracks/${ref.id}`), requestedById);
      return { title: null, tracks: t ? [t] : [] };
    }
    if (ref.type === 'album') {
      const album = await this.get(`/albums/${ref.id}`);
      const name = isObject(album) ? str(album.name) : null;
      const items = isObject(album) && isObject(album.tracks) ? asArray(album.tracks.items) : [];
      const tracks = items.map((t) => parseSpotifyTrack(t, requestedById)).filter((t): t is Track => t !== null);
      return { title: name, tracks: tracks.slice(0, MAX_SPOTIFY_ITEMS) };
    }
    const playlist = await this.get(`/playlists/${ref.id}?fields=name,tracks.items(track(name,duration_ms,artists(name)))`);
    const name = isObject(playlist) ? str(playlist.name) : null;
    const items = isObject(playlist) && isObject(playlist.tracks) ? asArray(playlist.tracks.items) : [];
    const tracks = items.map((i) => parseSpotifyTrack(isObject(i) ? i.track : null, requestedById)).filter((t): t is Track => t !== null);
    return { title: name, tracks: tracks.slice(0, MAX_SPOTIFY_ITEMS) };
  }
}
