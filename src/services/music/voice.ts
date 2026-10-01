/**
 * Conexão de voz do bot: pede a entrada no canal ao Gateway do Fluxer (op 4),
 * recebe a credencial LiveKit (VOICE_SERVER_UPDATE) e publica uma faixa de áudio.
 * docs.fluxer.app → Voice: "A client connects to the endpoint the Voice Server Update
 * grant names, presents the grant token, and speaks the LiveKit protocol from there."
 */
import type { FluxerClient } from '../../fluxer/client.js';
import type { VoiceServerUpdate } from '../../fluxer/types.js';
import { serialQueue } from '../../utils/queue.js';

/** Áudio que o player entrega: PCM 16 bits, 48 kHz, estéreo, em quadros de 10 ms. */
export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_SAMPLES = SAMPLE_RATE / 100;
export const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

/** Para onde o áudio vai (a faixa LiveKit, ou um falso nos testes). */
export interface AudioSink {
  /** Envia um quadro de 10 ms; resolve quando há espaço para o próximo (ritmo em tempo real). */
  captureFrame(pcm: Int16Array): Promise<void>;
  /** Mensagem de dados para quem está na sala (DataPacket LiveKit). */
  publishData(topic: string, payload: unknown): Promise<void>;
  close(): Promise<void>;
}

/** `onDisconnected`: a sala caiu sem o bot pedir (rede, LiveKit reiniciado, Fluxer tirou o bot). */
export type SinkFactory = (endpoint: string, token: string, onDisconnected: () => void) => Promise<AudioSink>;

/** Sink real: entra na sala LiveKit e publica a faixa "música". */
export const liveKitSink: SinkFactory = async (endpoint, token, onDisconnected) => {
  const rtc = await import('@livekit/rtc-node');
  const room = new rtc.Room();
  let closing = false;
  room.on(rtc.RoomEvent.Disconnected, () => {
    if (!closing) onDisconnected();
  });
  await room.connect(endpoint, token, { autoSubscribe: false, dynacast: false });
  const source = new rtc.AudioSource(SAMPLE_RATE, CHANNELS);
  const track = rtc.LocalAudioTrack.createAudioTrack('música', source);
  const options = new rtc.TrackPublishOptions();
  options.source = rtc.TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(track, options);
  const encoder = new TextEncoder();
  return {
    captureFrame: (pcm) => source.captureFrame(new rtc.AudioFrame(pcm, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES)),
    publishData: async (topic, payload) => {
      await room.localParticipant!.publishData(encoder.encode(JSON.stringify(payload)), { reliable: true, topic });
    },
    close: async () => {
      closing = true;
      await source.close().catch(() => undefined);
      await room.disconnect();
    },
  };
};

export const VOICE_GRANT_TIMEOUT_MS = 10_000;

export class VoiceConnection {
  channelId: string | null = null;
  private connectionId: string | null = null;
  sink: AudioSink | null = null;
  /** Chamado quando a conexão de voz cai sozinha. */
  onDropped: (() => void) | null = null;

  constructor(
    private readonly client: FluxerClient,
    private readonly sinkFactory: SinkFactory = liveKitSink,
    private readonly grantTimeoutMs = VOICE_GRANT_TIMEOUT_MS,
  ) {}

  get connected() {
    return this.sink !== null;
  }

  /** Espera a credencial LiveKit deste canal. O Fluxer não responde quando recusa. */
  private waitGrant(channelId: string): Promise<VoiceServerUpdate> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.gateway.off('dispatch', onDispatch);
        reject(
          new Error(
            'O Fluxer não liberou a entrada na sala de voz. Confira se o bot tem Ver canal, Conectar e Falar nesse canal e se a sala não está cheia.',
          ),
        );
      }, this.grantTimeoutMs);
      const onDispatch = (event: string, data: unknown) => {
        if (event !== 'VOICE_SERVER_UPDATE') return;
        const grant = data as VoiceServerUpdate;
        if (grant.channel_id !== channelId || (grant.guild_id && grant.guild_id !== this.client.guildId)) return;
        clearTimeout(timer);
        this.client.gateway.off('dispatch', onDispatch);
        resolve(grant);
      };
      this.client.gateway.on('dispatch', onDispatch);
    });
  }

  // Entrar e sair um de cada vez: dois !tocar ao mesmo tempo não abrem duas conexões.
  private readonly serial = serialQueue();

  /** Entra no canal (ou troca de canal) e prepara a faixa de áudio. */
  join(channelId: string): Promise<AudioSink> {
    return this.serial(() => this.doJoin(channelId));
  }

  private async doJoin(channelId: string): Promise<AudioSink> {
    if (this.sink && this.channelId === channelId) return this.sink;
    if (this.sink) await this.doLeave();
    const grant = this.waitGrant(channelId);
    // Surdo: o bot só toca, não precisa receber o áudio de ninguém.
    this.client.gateway.updateVoiceState({ guild_id: this.client.guildId, channel_id: channelId, self_mute: false, self_deaf: true });
    const { token, endpoint, connection_id } = await grant;
    this.connectionId = connection_id;
    this.channelId = channelId;
    try {
      let created: AudioSink | null = null;
      created = await this.sinkFactory(endpoint, token, () => {
        // Só vale para a conexão atual (uma antiga pode avisar depois de trocada).
        if (!created || this.sink !== created) return;
        void this.dropped().then(() => this.onDropped?.());
      });
      this.sink = created;
    } catch (err) {
      await this.doLeave();
      throw err;
    }
    return this.sink;
  }

  /** Sai da sala LiveKit e do canal de voz. */
  leave(): Promise<void> {
    return this.serial(() => this.doLeave());
  }

  private async doLeave() {
    const sink = this.sink;
    this.sink = null;
    if (sink) await sink.close().catch(() => undefined);
    if (this.connectionId) {
      this.client.gateway.updateVoiceState({ guild_id: this.client.guildId, channel_id: null, connection_id: this.connectionId });
    }
    this.connectionId = null;
    this.channelId = null;
  }

  /** O Fluxer tirou o bot da voz (ex.: um moderador desconectou): só esquece a conexão. */
  dropped(): Promise<void> {
    return this.serial(async () => {
      this.connectionId = null;
      await this.doLeave();
    });
  }
}
