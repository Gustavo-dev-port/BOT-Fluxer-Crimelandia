/**
 * Quem está em qual sala de voz, a partir dos eventos do Gateway
 * (GUILD_CREATE.voice_states, VOICE_STATE_UPDATE e PASSIVE_UPDATES.voice_states).
 * Conta minutos em voz e entradas em salas para as missões diárias, e sabe
 * quantas pessoas há em cada sala (usado pelas salas temporárias).
 */

export interface VoiceStateLike {
  user_id?: string | null;
  channel_id?: string | null;
  member?: { user?: { id: string; username: string; global_name?: string | null; bot?: boolean } } | null;
}

export interface VoiceUser {
  id: string;
  username: string;
}

interface Presence {
  channelId: string;
  /** Início do trecho de tempo ainda não contado. */
  since: number;
  user: VoiceUser;
}

export interface VoiceListener {
  /** Entrou numa sala (ou trocou de sala). */
  onJoin?(user: VoiceUser, channelId: string, previousChannelId: string | null): void;
  /** Saiu de uma sala (ou trocou de sala). */
  onLeave?(user: VoiceUser, channelId: string): void;
  /** Minutos inteiros em voz desde a última contagem. */
  onMinutes?(user: VoiceUser, minutes: number): void;
}

const MINUTE = 60_000;

export class VoicePresence {
  private readonly present = new Map<string, Presence>();
  private readonly listeners: VoiceListener[] = [];

  listen(listener: VoiceListener) {
    this.listeners.push(listener);
  }

  private emit<K extends keyof VoiceListener>(event: K, ...args: Parameters<NonNullable<VoiceListener[K]>>) {
    for (const l of this.listeners) (l[event] as ((...a: typeof args) => void) | undefined)?.(...args);
  }

  private static userOf(state: VoiceStateLike): VoiceUser | null {
    const u = state.member?.user;
    if (u?.bot) return null;
    const id = state.user_id ?? u?.id;
    if (!id) return null;
    return { id, username: u?.global_name ?? u?.username ?? id };
  }

  /** Conta os minutos inteiros de um trecho e guarda o resto para a próxima vez. */
  private credit(p: Presence, now: number) {
    const minutes = Math.floor((now - p.since) / MINUTE);
    if (minutes > 0) {
      p.since += minutes * MINUTE;
      this.emit('onMinutes', p.user, minutes);
    }
  }

  /**
   * Estado completo (GUILD_CREATE): quem já estava em voz passa a ser contado a partir
   * de agora, sem contar como "entrou". Quem não aparece mais é tratado como saída.
   */
  reset(states: VoiceStateLike[], now = Date.now()) {
    const seen = new Set<string>();
    for (const s of states) {
      const user = VoicePresence.userOf(s);
      if (!user || !s.channel_id) continue;
      seen.add(user.id);
      const current = this.present.get(user.id);
      if (current && current.channelId === s.channel_id) continue;
      if (current) this.update(s, now);
      else this.present.set(user.id, { channelId: s.channel_id, since: now, user });
    }
    for (const [id, p] of [...this.present])
      if (!seen.has(id)) this.update({ user_id: id, channel_id: null, member: { user: { id, username: p.user.username } } }, now);
  }

  /** VOICE_STATE_UPDATE (channel_id null = saiu). */
  update(state: VoiceStateLike, now = Date.now()) {
    const user = VoicePresence.userOf(state);
    if (!user) return;
    const current = this.present.get(user.id);
    const next = state.channel_id ?? null;
    if (current?.channelId === next) return; // mudou só mute/deaf/vídeo
    if (current) {
      this.credit(current, now);
      this.present.delete(user.id);
      this.emit('onLeave', current.user, current.channelId);
    }
    if (next) {
      this.present.set(user.id, { channelId: next, since: now, user });
      this.emit('onJoin', user, next, current?.channelId ?? null);
    }
  }

  /** Conta os minutos de quem continua em voz (chamado periodicamente). */
  flush(now = Date.now()) {
    for (const p of this.present.values()) this.credit(p, now);
  }

  /** Quantas pessoas (não bots) estão na sala. */
  count(channelId: string): number {
    let n = 0;
    for (const p of this.present.values()) if (p.channelId === channelId) n++;
    return n;
  }

  /** IDs de quem está na sala. */
  members(channelId: string): string[] {
    return [...this.present.values()].filter((p) => p.channelId === channelId).map((p) => p.user.id);
  }

  channelOf(userId: string): string | null {
    return this.present.get(userId)?.channelId ?? null;
  }
}

/** Instância única do bot. */
export const voicePresence = new VoicePresence();
