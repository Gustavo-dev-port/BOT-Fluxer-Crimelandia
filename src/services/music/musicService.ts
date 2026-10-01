/**
 * Serviço de música do servidor: pedidos (!tocar), fila salva no banco, histórico,
 * entrada/saída da sala de voz, player fixado e saída automática por inatividade.
 */
import { config } from '../../config.js';
import { prisma } from '../../database/client.js';
import { nowPlayingEmbed, trackLine } from '../../embeds/musicEmbed.js';
import type { FluxerClient } from '../../fluxer/client.js';
import type { MessagePayload, VoiceState } from '../../fluxer/types.js';
import { UserError } from '../../types/domain.js';
import { errorMeta, scoped } from '../../utils/logger.js';
import { getChannelId } from '../channels.js';
import { trackMission } from '../notifications/missionTracker.js';
import { upsertPinnedMessage } from '../notifications/pinnedMessage.js';
import { voicePresence } from '../voicePresence.js';
import { type AudioOpener, YouTubeAudio } from './audio.js';
import { MusicPlayer } from './player.js';
import { parseSpotifyUrl, SpotifyResolver } from './spotify.js';
import type { Track } from './types.js';
import { liveKitSink, type SinkFactory, VoiceConnection } from './voice.js';
import { isUrl, isYouTubeUrl, YouTubeResolver } from './youtube.js';

const log = scoped('música');

export interface MusicDeps {
  youtube: YouTubeResolver;
  spotify: SpotifyResolver;
  opener: AudioOpener;
  sinkFactory: SinkFactory;
  /** Espera pela credencial de voz (padrão 10 s). */
  grantTimeoutMs?: number;
}

export function defaultDeps(): MusicDeps {
  const youtube = new YouTubeResolver(config.music.ytdlpPath);
  return {
    youtube,
    spotify: new SpotifyResolver(config.music.spotify.clientId, config.music.spotify.clientSecret),
    // O ffmpeg só é procurado quando a primeira música toca.
    opener: { open: (track) => new YouTubeAudio(youtube).open(track) },
    sinkFactory: liveKitSink,
  };
}

export interface PlayResult {
  added: Track[];
  /** Nome da playlist/álbum, se o link era de uma. */
  collection: string | null;
  /** Quantas ficaram de fora por causa do limite da fila. */
  dropped: number;
  startedNow: boolean;
  channelId: string;
}

export class MusicService {
  readonly voice: VoiceConnection;
  readonly player: MusicPlayer;
  /** Canal de texto do último pedido (avisos, se não houver #musica). */
  private textChannelId: string | null = null;
  private idleSince: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: FluxerClient,
    private readonly deps: MusicDeps = defaultDeps(),
  ) {
    this.voice = new VoiceConnection(client, deps.sinkFactory, deps.grantTimeoutMs);
    this.voice.onDropped = () => void this.onVoiceDropped();
    this.player = new MusicPlayer(
      deps.opener,
      () => this.voice.sink,
      (track) => this.prepare(track),
      {
        onTrackStart: (t) => void this.onTrackStart(t),
        onError: (t, err) => void this.onTrackError(t, err),
        onQueueEnd: () => {
          this.idleSince ??= Date.now();
        },
        onChange: () => this.onChange(),
      },
      config.music.defaultVolume,
    );
  }

  /** Item do Spotify: busca no YouTube quando chega a vez. */
  private async prepare(track: Track): Promise<Track | null> {
    if (!track.query) return null;
    const found = await this.deps.youtube.search(track.query, track.requestedById, 'spotify');
    if (!found) {
      await this.announce({ content: `⚠️ Não achei **${track.title}** no YouTube; pulando.` });
      return null;
    }
    return { ...found, requestedById: track.requestedById };
  }

  /** Canal de voz de quem pediu (precisa estar numa sala). */
  private voiceChannelOf(userId: string): string {
    const channel = voicePresence.channelOf(userId);
    if (!channel) throw new UserError('Entre numa sala de voz primeiro; eu toco onde você estiver.');
    return channel;
  }

  /** Quem pede precisa estar na mesma sala em que o bot está tocando. */
  requireSameChannel(userId: string) {
    if (!this.voice.channelId) throw new UserError('Não estou tocando nada agora.');
    if (voicePresence.channelOf(userId) !== this.voice.channelId) {
      throw new UserError(`Entre em <#${this.voice.channelId}> para controlar a música.`);
    }
  }

  /** Transforma o pedido (busca, link do YouTube ou do Spotify) em músicas. */
  async resolve(query: string, requestedById: string): Promise<{ tracks: Track[]; collection: string | null }> {
    const q = query.trim();
    if (!q) throw new UserError('Diga o que tocar: `!tocar <nome da música ou link>`.');
    try {
      if (parseSpotifyUrl(q)) {
        const r = await this.deps.spotify.resolve(q, requestedById);
        return { tracks: r.tracks, collection: r.title };
      }
      if (isYouTubeUrl(q)) {
        const r = await this.deps.youtube.resolve(q, requestedById);
        return { tracks: r.tracks, collection: r.title };
      }
      if (isUrl(q)) throw new UserError('Só aceito links do YouTube e do Spotify (ou o nome da música).');
      const found = await this.deps.youtube.search(q, requestedById);
      return { tracks: found ? [found] : [], collection: null };
    } catch (err) {
      if (err instanceof UserError) throw err;
      log.error('falha ao buscar música', { query: q, ...errorMeta(err) });
      throw new UserError(`Não consegui buscar essa música: ${err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido'}`);
    }
  }

  /** !tocar: resolve, põe na fila, entra na sala de quem pediu e começa. */
  async play(userId: string, query: string, textChannelId: string, playNext = false): Promise<PlayResult> {
    if (!config.music.enabled) throw new UserError('A música está desligada neste servidor (MUSIC_ENABLED=false).');
    const channelId = this.voiceChannelOf(userId);
    if (this.voice.channelId && this.voice.channelId !== channelId && this.player.active) {
      throw new UserError(`Já estou tocando em <#${this.voice.channelId}>. Entre lá, ou use \`!parar\` antes.`);
    }
    const { tracks, collection } = await this.resolve(query, userId);
    if (!tracks.length) throw new UserError('Não encontrei nada com isso.');

    try {
      await this.voice.join(channelId);
    } catch (err) {
      log.error('falha ao entrar na sala de voz', { channel: channelId, ...errorMeta(err) });
      throw new UserError(err instanceof Error ? err.message : 'Não consegui entrar na sala de voz.');
    }
    this.textChannelId = textChannelId;
    this.idleSince = null;
    const startedNow = !this.player.active;
    const count = this.player.queue.add(tracks, { playNext });
    this.player.start();
    this.scheduleSave();
    log.info(`pedido: ${tracks.length} música(s)`, { user: userId, query, collection });
    return { added: tracks.slice(0, count), collection, dropped: tracks.length - count, startedNow, channelId };
  }

  /** Para, limpa a fila e sai da sala. */
  async stop(reason: string) {
    this.player.stop();
    await this.player.idle();
    await this.voice.leave();
    this.idleSince = null;
    this.scheduleSave();
    this.refreshPlayer();
    log.info(`parado: ${reason}`);
  }

  // ─── Eventos do player ────────────────────────────────────────────────────

  private async onTrackStart(t: Track) {
    log.info(`tocando: ${t.title} — ${t.artist}`, { url: t.url, user: t.requestedById, channel: this.voice.channelId });
    await prisma.musicHistory
      .create({
        data: {
          guildId: this.client.guildId,
          channelId: this.voice.channelId ?? '',
          title: t.title,
          artist: t.artist,
          url: t.url,
          durationSeconds: t.durationSeconds,
          requestedById: t.requestedById,
        },
      })
      .catch((err: unknown) => log.error('falha ao salvar histórico', errorMeta(err)));
    const musicChannel = await getChannelId(this.client, 'music');
    // Sem #musica configurado, avisa no canal do pedido.
    if (!musicChannel && this.textChannelId) {
      await this.client
        .send(this.textChannelId, { content: `🎵 Tocando agora: ${trackLine(t)}`, allowed_mentions: { parse: [] } })
        .catch(() => undefined);
    }
  }

  private async onTrackError(t: Track, err: unknown) {
    log.error(`falha ao tocar ${t.title}`, { url: t.url, ...errorMeta(err) });
    await this.announce({ content: `⚠️ Não consegui tocar **${t.title}**; pulando.` });
  }

  private onChange() {
    this.scheduleSave();
    this.refreshPlayer();
  }

  private async announce(payload: MessagePayload) {
    const channel = (await getChannelId(this.client, 'music')) ?? this.textChannelId;
    if (channel) await this.client.send(channel, { allowed_mentions: { parse: [] }, ...payload }).catch(() => undefined);
  }

  /** Atualiza o player fixado em #musica (no máximo uma vez a cada 2 s). */
  refreshPlayer() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void upsertPinnedMessage(this.client, 'music', 'music-player', {
        embeds: [nowPlayingEmbed(this.player, this.voice.channelId)],
        allowed_mentions: { parse: [] },
      }).catch((err: unknown) => log.error('falha ao atualizar o player', errorMeta(err)));
    }, 2_000);
    this.refreshTimer.unref?.();
  }

  // ─── Fila salva ───────────────────────────────────────────────────────────

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveQueue().catch((err: unknown) => log.error('falha ao salvar a fila', errorMeta(err)));
    }, 500);
    this.saveTimer.unref?.();
  }

  async saveQueue() {
    const items = this.player.queue.snapshot();
    const guildId = this.client.guildId;
    await prisma.$transaction([
      prisma.musicQueue.deleteMany({ where: { guildId } }),
      prisma.musicQueue.createMany({
        data: items.map((t, position) => ({
          guildId,
          position,
          title: t.title,
          artist: t.artist,
          url: t.url,
          query: t.query ?? null,
          durationSeconds: t.durationSeconds,
          thumbnail: t.thumbnail,
          source: t.source,
          requestedById: t.requestedById,
        })),
      }),
    ]);
  }

  /** Recarrega a fila salva (depois de reiniciar). Ela volta a tocar com !continuar. */
  async restoreQueue(): Promise<number> {
    const rows = await prisma.musicQueue.findMany({ where: { guildId: this.client.guildId }, orderBy: { position: 'asc' } });
    const tracks: Track[] = rows.map((r) => ({
      title: r.title,
      artist: r.artist,
      url: r.url,
      durationSeconds: r.durationSeconds,
      thumbnail: r.thumbnail,
      source: r.source as Track['source'],
      requestedById: r.requestedById,
      ...(r.query ? { query: r.query } : {}),
    }));
    this.player.queue.add(tracks);
    return tracks.length;
  }

  /** !continuar sem nada tocando: volta a tocar a fila salva na sala de quem pediu. */
  async resumeQueue(userId: string, textChannelId: string): Promise<boolean> {
    if (this.player.active || (!this.player.queue.size && !this.player.queue.current)) return false;
    const channelId = this.voiceChannelOf(userId);
    try {
      await this.voice.join(channelId);
    } catch (err) {
      throw new UserError(err instanceof Error ? err.message : 'Não consegui entrar na sala de voz.');
    }
    this.textChannelId = textChannelId;
    this.idleSince = null;
    this.player.start();
    return true;
  }

  // ─── Rotina (a cada minuto) e eventos de voz ──────────────────────────────

  /** Minutos de música para as missões e saída automática com a sala vazia. */
  async tick(now = Date.now()) {
    const channel = this.voice.channelId;
    if (!channel) return;
    const listeners = voicePresence.members(channel);
    if (this.player.state === 'playing') {
      for (const id of listeners) void trackMission(this.client, id, 'music_minutes');
    }
    const idle = listeners.length === 0 || !this.player.active;
    if (!idle) {
      this.idleSince = null;
    } else {
      this.idleSince ??= now;
      if (now - this.idleSince >= config.music.idleMinutes * 60_000) {
        await this.stop(listeners.length === 0 ? 'sala vazia' : 'sem músicas na fila');
        await this.announce({
          content: `👋 Saí de <#${channel}>: ${listeners.length === 0 ? 'ninguém ouvindo' : 'a fila acabou'} há ${config.music.idleMinutes} minutos.`,
        });
      }
    }
    if (this.player.state !== 'idle') this.refreshPlayer();
  }

  /** A conexão de voz caiu sozinha: guarda a fila para o !continuar e avisa uma vez. */
  private async onVoiceDropped() {
    const channel = this.voice.channelId;
    const saved = this.player.queue.snapshot();
    log.warn('a conexão de voz caiu; parando a música', { channel, queued: saved.length });
    this.player.stop();
    await this.player.idle();
    this.player.queue.add(saved);
    await this.saveQueue().catch((err: unknown) => log.error('falha ao salvar a fila', errorMeta(err)));
    this.refreshPlayer();
    await this.announce({
      content: `⚠️ A conexão de voz caiu.${saved.length ? ` ${saved.length} música(s) guardadas: entre numa sala e use \`!continuar\`.` : ''}`,
    });
  }

  /** O próprio bot saiu da voz por fora (moderador desconectou, canal apagado...). */
  onBotVoiceState(state: VoiceState) {
    if (!this.voice.channelId || state.channel_id) return;
    log.warn('o bot foi tirado da sala de voz; parando a música');
    this.player.stop();
    void this.voice.dropped();
  }
}

let service: MusicService | null = null;

export function musicService(client: FluxerClient): MusicService {
  service ??= new MusicService(client);
  return service;
}

/** Troca o serviço (testes). */
export function setMusicService(s: MusicService | null) {
  service = s;
}
