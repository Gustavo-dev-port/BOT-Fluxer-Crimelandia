/**
 * Fila de músicas (lógica pura): atual, próximas, anteriores, repetir e embaralhar.
 */
import type { RepeatMode, Track } from './types.js';

export const MAX_QUEUE = 200;

export class MusicQueue {
  /** Tocadas antes da atual (mais recente por último), para o "voltar". */
  private history: Track[] = [];
  private upcoming: Track[] = [];
  current: Track | null = null;
  repeat: RepeatMode = 'off';

  get size() {
    return this.upcoming.length;
  }

  get next(): readonly Track[] {
    return this.upcoming;
  }

  /** Adiciona no fim (ou logo depois da atual). Devolve quantas couberam. */
  add(tracks: Track[], { playNext = false } = {}): number {
    const room = Math.max(0, MAX_QUEUE - this.upcoming.length);
    const accepted = tracks.slice(0, room);
    if (playNext) this.upcoming.unshift(...accepted);
    else this.upcoming.push(...accepted);
    return accepted.length;
  }

  /**
   * Avança para a próxima música, respeitando o modo de repetição.
   * `forced` (skip) ignora o "repetir música".
   */
  advance(forced = false): Track | null {
    if (this.current && this.repeat === 'track' && !forced) return this.current;
    if (this.current) {
      this.history.push(this.current);
      if (this.history.length > MAX_QUEUE) this.history.shift();
      if (this.repeat === 'queue') this.upcoming.push(this.current);
    }
    this.current = this.upcoming.shift() ?? null;
    return this.current;
  }

  /** Volta para a anterior; a atual volta para o começo da fila. */
  previous(): Track | null {
    const prev = this.history.pop();
    if (!prev) return null;
    if (this.current) this.upcoming.unshift(this.current);
    this.current = prev;
    return prev;
  }

  shuffle(rand: () => number = Math.random) {
    for (let i = this.upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [this.upcoming[i], this.upcoming[j]] = [this.upcoming[j], this.upcoming[i]];
    }
  }

  /** Remove a música na posição (1 = próxima). */
  remove(position: number): Track | null {
    if (!Number.isInteger(position) || position < 1 || position > this.upcoming.length) return null;
    return this.upcoming.splice(position - 1, 1)[0];
  }

  /** Troca o item atual (ex.: depois de buscar no YouTube um item vindo do Spotify). */
  replaceCurrent(track: Track) {
    this.current = track;
  }

  clear() {
    this.upcoming = [];
    this.history = [];
    this.current = null;
  }

  /** Estado para salvar no banco (MusicQueue). */
  snapshot(): Track[] {
    return [...(this.current ? [this.current] : []), ...this.upcoming];
  }
}
