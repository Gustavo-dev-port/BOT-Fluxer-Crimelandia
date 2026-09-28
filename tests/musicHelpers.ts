/** Apoio aos testes de música: sala falsa e áudio de teste decodificado pelo ffmpeg. */
import { spawn } from 'node:child_process';
import { ffmpegPath, type AudioOpener } from '../src/services/music/audio.js';
import type { AudioSink } from '../src/services/music/voice.js';

/** Sala falsa: guarda os quadros; `delayMs` simula o ritmo em tempo real. */
export class FakeSink implements AudioSink {
  frames: Int16Array[] = [];
  data: unknown[] = [];
  closed = false;
  constructor(private readonly delayMs = 0) {}
  async captureFrame(pcm: Int16Array) {
    this.frames.push(pcm);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }
  async publishData(_topic: string, payload: unknown) {
    this.data.push(payload);
  }
  async close() {
    this.closed = true;
  }
}

/** Áudio de teste: tom senoidal decodificado pelo ffmpeg (mesmo formato do YouTube). */
export const sineOpener = (seconds = 0.5): AudioOpener & { opened: string[] } => {
  const opened: string[] = [];
  return {
    opened,
    open(track) {
      opened.push(track.title);
      const p = spawn(ffmpegPath(), [
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:duration=${seconds}`,
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        'pipe:1',
      ]);
      return { pcm: p.stdout, stop: () => p.kill('SIGKILL') };
    },
  };
};
