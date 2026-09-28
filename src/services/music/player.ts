/**
 * Player: toca a fila na sala de voz, quadro a quadro (10 ms), no ritmo do LiveKit.
 * Pausar segura o envio; pular/parar encerra o áudio atual; o volume é aplicado
 * no próprio PCM, então muda na hora.
 */
import type { AudioOpener, OpenedAudio } from './audio.js';
import { MusicQueue } from './queue.js';
import type { RepeatMode, Track } from './types.js';
import { CHANNELS, FRAME_BYTES, FRAME_SAMPLES, type AudioSink } from './voice.js';

export type PlayerState = 'idle' | 'playing' | 'paused';

export const MAX_VOLUME = 150;
/** A cada quanto tempo o estado vai para a sala como DataPacket. */
export const SYNC_INTERVAL_MS = 5_000;
export const SYNC_TOPIC = 'fluxer.music';

export interface PlayerEvents {
  onTrackStart?(track: Track): void;
  onTrackEnd?(track: Track, reason: 'finished' | 'skipped' | 'error'): void;
  onError?(track: Track, error: unknown): void;
  onQueueEnd?(): void;
  /** Estado mudou (pausa, volume, fila...): hora de atualizar o player fixado. */
  onChange?(): void;
}

/** Aplica o volume (0–150%) nas amostras, sem estourar o limite de 16 bits. */
export function applyVolume(pcm: Int16Array, volume: number): Int16Array {
  if (volume === 100) return pcm;
  const factor = volume / 100;
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * factor)));
  return pcm;
}

export class MusicPlayer {
  readonly queue = new MusicQueue();
  state: PlayerState = 'idle';
  volume: number;
  /** Posição na música atual. */
  positionMs = 0;
  private audio: OpenedAudio | null = null;
  private interrupt: 'skip' | 'previous' | 'stop' | null = null;
  private resumeWaiter: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private lastSync = 0;

  constructor(
    private readonly opener: AudioOpener,
    private readonly getSink: () => AudioSink | null,
    /** Completa itens pendentes (ex.: Spotify → busca no YouTube). */
    private readonly prepare: (track: Track) => Promise<Track | null>,
    private readonly events: PlayerEvents = {},
    defaultVolume = 100,
  ) {
    this.volume = defaultVolume;
  }

  get active() {
    return this.running !== null;
  }

  /** Começa a tocar, se ainda não estiver tocando. */
  start() {
    if (this.running) return;
    this.running = this.run().finally(() => {
      this.running = null;
    });
  }

  /** Espera o laço terminar (testes e desligamento). */
  async idle() {
    await this.running;
  }

  private async run() {
    let track = this.queue.current ?? this.queue.advance();
    while (track) {
      if (!this.getSink()) break;
      if (!track.url) {
        const ready = await this.prepare(track).catch((err: unknown) => {
          this.events.onError?.(track!, err);
          return null;
        });
        if (!ready) {
          track = this.queue.advance(true);
          continue;
        }
        this.queue.replaceCurrent(ready);
        track = ready;
      }

      this.state = 'playing';
      this.positionMs = 0;
      this.interrupt = null;
      this.lastSync = 0;
      this.events.onTrackStart?.(track);
      this.events.onChange?.();
      // Quem está na sala fica sabendo da música nova na hora.
      void this.sync();
      let reason: 'finished' | 'skipped' | 'error' = 'finished';
      try {
        await this.stream(track);
        if (this.interrupt) reason = 'skipped';
      } catch (err) {
        reason = 'error';
        this.events.onError?.(track, err);
      } finally {
        this.audio?.stop();
        this.audio = null;
      }
      this.events.onTrackEnd?.(track, reason);

      const interrupt = this.interrupt;
      this.interrupt = null;
      if (interrupt === 'stop') break;
      // "Voltar" já trocou a música atual; os outros casos avançam (pular ignora o repetir-música).
      track = interrupt === 'previous' ? this.queue.current : this.queue.advance(interrupt === 'skip' || reason === 'error');
    }
    this.state = 'idle';
    this.positionMs = 0;
    this.events.onQueueEnd?.();
    this.events.onChange?.();
  }

  private async stream(track: Track) {
    const audio = this.opener.open(track);
    this.audio = audio;
    let pending: Buffer = Buffer.alloc(0);
    for await (const chunk of audio.pcm as AsyncIterable<Buffer>) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= FRAME_BYTES) {
        if (this.interrupt) return;
        if (this.state === 'paused') await new Promise<void>((resolve) => (this.resumeWaiter = resolve));
        if (this.interrupt) return;
        const sink = this.getSink();
        if (!sink) {
          this.interrupt = 'stop';
          return;
        }
        // Cópia alinhada do quadro (o Buffer pode começar num byte ímpar).
        const frame = new Int16Array(FRAME_SAMPLES * CHANNELS);
        Buffer.from(frame.buffer).set(pending.subarray(0, FRAME_BYTES));
        pending = pending.subarray(FRAME_BYTES);
        await sink.captureFrame(applyVolume(frame, this.volume));
        this.positionMs += 10;
        if (this.positionMs - this.lastSync >= SYNC_INTERVAL_MS) {
          this.lastSync = this.positionMs;
          void this.sync();
        }
      }
    }
  }

  /** Estado do player para a sala (DataPacket), para players sincronizados. */
  syncPayload() {
    const t = this.queue.current;
    return {
      state: this.state,
      positionMs: this.positionMs,
      volume: this.volume,
      repeat: this.queue.repeat,
      track: t
        ? { title: t.title, artist: t.artist, durationSeconds: t.durationSeconds, url: t.url, requestedById: t.requestedById }
        : null,
      queue: this.queue.next.slice(0, 20).map((q) => ({ title: q.title, artist: q.artist })),
    };
  }

  async sync() {
    await this.getSink()
      ?.publishData(SYNC_TOPIC, this.syncPayload())
      .catch(() => undefined);
  }

  pause(): boolean {
    if (this.state !== 'playing') return false;
    this.state = 'paused';
    this.events.onChange?.();
    void this.sync();
    return true;
  }

  resume(): boolean {
    if (this.state !== 'paused') return false;
    this.state = 'playing';
    this.resumeWaiter?.();
    this.resumeWaiter = null;
    this.events.onChange?.();
    void this.sync();
    return true;
  }

  private interruptWith(kind: 'skip' | 'previous' | 'stop') {
    this.interrupt = kind;
    this.audio?.stop();
    // Se estava pausado, solta a espera para o laço perceber.
    this.resumeWaiter?.();
    this.resumeWaiter = null;
    if (this.state === 'paused') this.state = 'playing';
  }

  skip(): boolean {
    if (!this.active) return false;
    this.interruptWith('skip');
    return true;
  }

  previous(): Track | null {
    if (!this.active) return null;
    const prev = this.queue.previous();
    if (prev) this.interruptWith('previous');
    return prev;
  }

  /** Para tudo e limpa a fila. */
  stop() {
    this.queue.clear();
    if (this.active) this.interruptWith('stop');
    this.events.onChange?.();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(MAX_VOLUME, Math.round(volume)));
    this.events.onChange?.();
    void this.sync();
  }

  setRepeat(mode: RepeatMode) {
    this.queue.repeat = mode;
    this.events.onChange?.();
  }

  shuffle() {
    this.queue.shuffle();
    this.events.onChange?.();
  }
}
