/**
 * Integração com um servidor LiveKit de verdade (opcional).
 * Rode com um LiveKit local em modo dev:
 *   livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1
 *   LIVEKIT_TEST_URL=ws://127.0.0.1:7880 npx vitest run tests/music.livekit.test.ts
 * O Fluxer falso entrega credenciais reais (sala guild_<id>_channel_<id>, como o Fluxer);
 * o bot publica o áudio e um segundo participante confere que a música chega.
 */
import { AccessToken } from 'livekit-server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onVoiceEvent } from '../src/events/voiceState.js';
import { FluxerClient } from '../src/fluxer/client.js';
import { MusicService } from '../src/services/music/musicService.js';
import { SpotifyResolver } from '../src/services/music/spotify.js';
import { liveKitSink } from '../src/services/music/voice.js';
import { YouTubeResolver } from '../src/services/music/youtube.js';
import { voicePresence } from '../src/services/voicePresence.js';
import { GUILD_ID, MockFluxer, TOKEN } from './mockFluxer.js';
import { sineOpener } from './musicHelpers.js';

const url = process.env.LIVEKIT_TEST_URL;
const key = process.env.LIVEKIT_TEST_KEY ?? 'devkey';
const secret = process.env.LIVEKIT_TEST_SECRET ?? 'secret';

async function token(room: string, identity: string) {
  const t = new AccessToken(key, secret, { identity });
  t.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return t.toJwt();
}

describe.skipIf(!url)('música num LiveKit real', () => {
  let mock: MockFluxer;
  let client: FluxerClient;

  beforeAll(async () => {
    mock = await new MockFluxer().start();
    // Mesma convenção do Fluxer: sala guild_{guild}_channel_{canal}, identidade user_{id}_{conexão}.
    mock.voiceGrant = () => ({ token: '', endpoint: url! });
    client = await FluxerClient.create(mock.origin, TOKEN, GUILD_ID);
    client.gateway.on('dispatch', (event, data) => onVoiceEvent(client, event, data));
    const ready = new Promise((r) => client.gateway.once('ready', r));
    client.login();
    await ready;
  });
  afterAll(async () => {
    client.destroy();
    await mock.stop();
  });

  it('o bot publica a música na sala e quem está lá ouve (áudio e DataPackets de sincronização)', async () => {
    const channel = 'voz-real';
    const room = `guild_${GUILD_ID}_channel_${channel}`;
    const botToken = await token(room, 'user_1_conn-1');
    mock.voiceGrant = () => ({ token: botToken, endpoint: url! });

    const service = new MusicService(client, {
      youtube: new YouTubeResolver('yt-dlp', async () =>
        JSON.stringify({
          id: 'x',
          title: 'Tom de teste',
          channel: 'ffmpeg',
          duration: 4,
          webpage_url: 'https://www.youtube.com/watch?v=x',
        }),
      ),
      spotify: new SpotifyResolver('', ''),
      opener: sineOpener(4),
      sinkFactory: liveKitSink,
    });

    const rtc = await import('@livekit/rtc-node');
    const listener = new rtc.Room();
    let frames = 0;
    let energy = 0;
    const packets: unknown[] = [];
    listener.on(rtc.RoomEvent.DataReceived, (payload, _p, _k, topic) => {
      if (topic === 'fluxer.music') packets.push(JSON.parse(new TextDecoder().decode(payload)));
    });
    listener.on(rtc.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== rtc.TrackKind.KIND_AUDIO) return;
      void (async () => {
        for await (const f of new rtc.AudioStream(track, 48000, 1)) {
          frames++;
          for (const s of f.data) energy += Math.abs(s);
          if (frames >= 200) break;
        }
      })();
    });
    await listener.connect(url!, await token(room, 'user_200_ouvinte'), { autoSubscribe: true, dynacast: false });

    // O ouvinte "está" na sala de voz do Fluxer (para o bot saber onde tocar).
    voicePresence.update({ user_id: '200', channel_id: channel, member: { user: { id: '200', username: 'ouvinte' } } });
    const result = await service.play('200', 'tom de teste', 'c-comandos');
    expect(result.channelId).toBe(channel);

    const start = Date.now();
    while ((frames < 200 || packets.length === 0) && Date.now() - start < 15_000) await new Promise((r) => setTimeout(r, 50));
    expect(frames).toBeGreaterThanOrEqual(200);
    expect(energy / (frames * 480)).toBeGreaterThan(200); // som de verdade, não silêncio
    expect(packets[0]).toMatchObject({ state: 'playing', track: { title: 'Tom de teste' } });

    await service.stop('fim do teste');
    await listener.disconnect();
    voicePresence.update({ user_id: '200', channel_id: null, member: { user: { id: '200', username: 'ouvinte' } } });
  }, 30_000);
});
