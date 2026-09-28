/**
 * Abre o áudio de uma música como PCM 16 bits, 48 kHz, estéreo:
 * yt-dlp (áudio do YouTube) → ffmpeg (decodifica) → PCM. Tudo por pipe, sem arquivos.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { CHANNELS, SAMPLE_RATE } from './voice.js';
import type { Track } from './types.js';
import type { YouTubeResolver } from './youtube.js';

export interface OpenedAudio {
  pcm: Readable;
  /** Encerra os processos (pular, parar). */
  stop(): void;
}

export interface AudioOpener {
  open(track: Track): OpenedAudio;
}

/** ffmpeg: FFMPEG_PATH, ou o binário do pacote @ffmpeg-installer/ffmpeg. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const require = createRequire(import.meta.url);
  return (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
}

/** Argumentos do ffmpeg para decodificar a entrada em PCM no formato da faixa LiveKit. */
export function ffmpegArgs(input = 'pipe:0'): string[] {
  return ['-loglevel', 'error', '-i', input, '-vn', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'];
}

const kill = (p: ChildProcess | null) => {
  if (p && p.exitCode === null && !p.killed) p.kill('SIGKILL');
};

export class YouTubeAudio implements AudioOpener {
  constructor(
    private readonly youtube: YouTubeResolver,
    private readonly ffmpeg = ffmpegPath(),
  ) {}

  open(track: Track): OpenedAudio {
    const source = this.youtube.audioProcess(track.url);
    const decoder = spawn(this.ffmpeg, ffmpegArgs(), { stdio: ['pipe', 'pipe', 'ignore'] });
    source.stdout!.pipe(decoder.stdin!);
    // Pular/parar fecha o pipe no meio: não é erro.
    decoder.stdin!.on('error', () => undefined);
    source.stdout!.on('error', () => undefined);
    source.on('error', (err) => decoder.stdout!.destroy(err));
    return {
      pcm: decoder.stdout!,
      stop: () => {
        kill(source);
        kill(decoder);
      },
    };
  }
}
