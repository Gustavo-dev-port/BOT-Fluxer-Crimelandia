/**
 * YouTube via yt-dlp: busca, resolução de links (vídeo ou playlist) e o áudio.
 * O áudio sai do yt-dlp direto para o ffmpeg por pipe; nada é salvo em disco.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { asArray, isObject, num, str } from '../../utils/http.js';
import type { Track } from './types.js';

export const MAX_PLAYLIST_ITEMS = 100;

export function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

export function isYouTubeUrl(text: string): boolean {
  return /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(text.trim());
}

/** Link de playlist (sem vídeo específico) do YouTube. */
export function isYouTubePlaylist(url: string): boolean {
  try {
    const u = new URL(url);
    return u.searchParams.has('list') && (u.pathname === '/playlist' || !u.searchParams.has('v'));
  } catch {
    return false;
  }
}

/** Converte o JSON de um vídeo do yt-dlp (--dump-json) numa música. */
export function parseVideo(raw: unknown, requestedById: string, source: Track['source'] = 'youtube'): Track | null {
  if (!isObject(raw)) return null;
  const title = str(raw.title);
  const url = str(raw.webpage_url) ?? str(raw.url) ?? (str(raw.id) ? `https://www.youtube.com/watch?v=${str(raw.id)}` : null);
  if (!title || !url) return null;
  const duration = num(raw.duration);
  return {
    title,
    artist: str(raw.artist) ?? str(raw.channel) ?? str(raw.uploader) ?? 'YouTube',
    durationSeconds: duration === null || raw.is_live === true ? null : Math.round(duration),
    url: url.startsWith('http') ? url : `https://www.youtube.com/watch?v=${url}`,
    thumbnail: str(raw.thumbnail) ?? (str(raw.id) ? `https://i.ytimg.com/vi/${str(raw.id)}/hqdefault.jpg` : null),
    source,
    requestedById,
  };
}

/** Converte o JSON de uma playlist (--flat-playlist --dump-single-json). */
export function parsePlaylist(raw: unknown, requestedById: string): { title: string; tracks: Track[] } {
  if (!isObject(raw)) return { title: 'Playlist', tracks: [] };
  const tracks = asArray(raw.entries)
    .map((e) => parseVideo(e, requestedById))
    .filter((t): t is Track => t !== null)
    .slice(0, MAX_PLAYLIST_ITEMS);
  return { title: str(raw.title) ?? 'Playlist', tracks };
}

/** Executa um programa e devolve a saída padrão (usado para as consultas do yt-dlp). */
export type Runner = (command: string, args: string[]) => Promise<string>;

export const runProcess: Runner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new Error(`${command} não pôde ser executado (${e.message}). Instale o yt-dlp ou defina YTDLP_PATH.`)));
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} saiu com código ${code}: ${err.trim().slice(0, 300)}`)),
    );
  });

export class YouTubeResolver {
  constructor(
    private readonly ytdlp: string,
    private readonly run: Runner = runProcess,
  ) {}

  private json(args: string[]): Promise<unknown> {
    return this.run(this.ytdlp, ['--no-warnings', '--skip-download', ...args]).then((out) => JSON.parse(out) as unknown);
  }

  /** Primeiro resultado da busca no YouTube. */
  async search(query: string, requestedById: string, source: Track['source'] = 'search'): Promise<Track | null> {
    const raw = await this.json(['--dump-json', '--no-playlist', `ytsearch1:${query}`]);
    return parseVideo(raw, requestedById, source);
  }

  /** Vídeo único ou playlist inteira (até MAX_PLAYLIST_ITEMS). */
  async resolve(url: string, requestedById: string): Promise<{ title: string | null; tracks: Track[] }> {
    if (isYouTubePlaylist(url)) {
      const { title, tracks } = parsePlaylist(
        await this.json(['--flat-playlist', '--dump-single-json', '--playlist-end', String(MAX_PLAYLIST_ITEMS), url]),
        requestedById,
      );
      return { title, tracks };
    }
    const track = parseVideo(await this.json(['--dump-json', '--no-playlist', url]), requestedById);
    return { title: null, tracks: track ? [track] : [] };
  }

  /** Processo que escreve o áudio do vídeo na saída padrão. */
  audioProcess(url: string): ChildProcess {
    return spawn(this.ytdlp, ['--no-warnings', '--quiet', '--no-playlist', '-f', 'bestaudio/best', '-o', '-', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}
