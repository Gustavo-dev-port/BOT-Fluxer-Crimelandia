import { EventEmitter } from 'node:events';
import type { FluxerClient } from '../src/fluxer/client.js';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clock, nowPlayingEmbed, queueEmbed } from '../src/embeds/musicEmbed.js';
import { applyVolume, MusicPlayer } from '../src/services/music/player.js';
import { MAX_QUEUE, MusicQueue } from '../src/services/music/queue.js';
import { parseSpotifyUrl, SpotifyResolver } from '../src/services/music/spotify.js';
import type { Track } from '../src/services/music/types.js';
import { FRAME_BYTES } from '../src/services/music/voice.js';
import { FakeSink, sineOpener } from './musicHelpers.js';
import { isYouTubePlaylist, isYouTubeUrl, parsePlaylist, parseVideo, YouTubeResolver } from '../src/services/music/youtube.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/music/${name}`, import.meta.url), 'utf8');

export const t = (title: string, extra: Partial<Track> = {}): Track => ({
  title,
  artist: 'Artista',
  durationSeconds: 1,
  url: `https://www.youtube.com/watch?v=${title}`,
  thumbnail: null,
  source: 'youtube',
  requestedById: '100',
  ...extra,
});

describe('fila', () => {
  it('avança, repete música/fila, volta e remove', () => {
    const q = new MusicQueue();
    q.add([t('a'), t('b'), t('c')]);
    expect(q.advance()?.title).toBe('a');
    q.repeat = 'track';
    expect(q.advance()?.title).toBe('a'); // repetir música
    expect(q.advance(true)?.title).toBe('b'); // pular ignora o repetir-música
    q.repeat = 'queue';
    expect(q.advance()?.title).toBe('c');
    // Com "repetir fila", a que terminou volta para o fim ("a" tocou antes de ligar o modo).
    expect(q.next.map((x) => x.title)).toEqual(['b']);
    expect(q.previous()?.title).toBe('b');
    expect(q.current?.title).toBe('b');
    expect(q.next.map((x) => x.title)).toEqual(['c', 'b']);
    expect(q.remove(1)?.title).toBe('c');
    expect(q.remove(9)).toBeNull();
    q.repeat = 'off';
    expect(q.advance()?.title).toBe('b');
    q.add([t('x'), t('y')]);
    q.add([t('z')], { playNext: true });
    expect(q.next.map((x) => x.title)).toEqual(['z', 'x', 'y']);
    expect(q.snapshot().map((x) => x.title)).toEqual(['b', 'z', 'x', 'y']);
  });
  it('limite da fila e embaralhar sem perder itens', () => {
    const q = new MusicQueue();
    expect(q.add(Array.from({ length: MAX_QUEUE + 5 }, (_, i) => t(`m${i}`)))).toBe(MAX_QUEUE);
    const before = q.next.map((x) => x.title).sort();
    q.shuffle(() => 0.3);
    expect(q.next.map((x) => x.title).sort()).toEqual(before);
  });
});

describe('volume e formatação', () => {
  it('volume aplicado no PCM, sem estourar 16 bits', () => {
    expect([...applyVolume(Int16Array.from([100, -100, 30000]), 50)]).toEqual([50, -50, 15000]);
    expect([...applyVolume(Int16Array.from([30000, -30000]), 150)]).toEqual([32767, -32768]);
  });
  it('relógio', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(245)).toBe('4:05');
    expect(clock(3725)).toBe('1:02:05');
  });
});

describe('YouTube (yt-dlp)', () => {
  it('reconhece links', () => {
    expect(isYouTubeUrl('https://youtu.be/abc')).toBe(true);
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTubeUrl('https://vimeo.com/1')).toBe(false);
    expect(isYouTubePlaylist('https://www.youtube.com/playlist?list=PL1')).toBe(true);
    expect(isYouTubePlaylist('https://www.youtube.com/watch?v=abc&list=PL1')).toBe(false);
  });
  it('lê o JSON de vídeo e de playlist', () => {
    expect(parseVideo(JSON.parse(fixture('video.json')), '1')).toMatchObject({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      durationSeconds: 213,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      source: 'youtube',
    });
    const p = parsePlaylist(JSON.parse(fixture('playlist.json')), '1');
    expect(p.title).toBe('Lo-fi do Reino');
    expect(p.tracks.map((x) => [x.title, x.durationSeconds])).toEqual([
      ['Faixa 1', 120],
      ['Faixa 2', 96],
    ]);
    expect(p.tracks[0].thumbnail).toContain('aaa11111111');
  });
  it('chama o yt-dlp com busca, vídeo e playlist', async () => {
    const calls: string[][] = [];
    const yt = new YouTubeResolver('yt-dlp', async (_cmd, args) => {
      calls.push(args);
      return args.includes('--flat-playlist') ? fixture('playlist.json') : fixture('video.json');
    });
    expect((await yt.search('rick astley', '1'))?.source).toBe('search');
    expect(calls[0].at(-1)).toBe('ytsearch1:rick astley');
    expect((await yt.resolve('https://youtu.be/dQw4w9WgXcQ', '1')).tracks).toHaveLength(1);
    const pl = await yt.resolve('https://www.youtube.com/playlist?list=PL123', '1');
    expect(pl).toMatchObject({ title: 'Lo-fi do Reino' });
    expect(calls[2]).toContain('--flat-playlist');
  });
});

describe('Spotify', () => {
  let server: Server;
  let base = '';
  const hits: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/token') return send(200, { access_token: 'tk', expires_in: 3600 });
      if (req.url?.startsWith('/v1/tracks/')) return send(200, { name: 'Faixa', duration_ms: 1000, artists: [{ name: 'Alguém' }] });
      if (req.url?.startsWith('/v1/albums/')) return send(200, JSON.parse(fixture('spotify-album.json')));
      if (req.url?.startsWith('/v1/playlists/')) return send(200, JSON.parse(fixture('spotify-playlist.json')));
      if (req.url?.startsWith('/oembed')) return send(200, { title: 'Só o Nome' });
      send(404, {});
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('reconhece links e URIs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/abc123?si=x')).toEqual({ type: 'track', id: 'abc123' });
    expect(parseSpotifyUrl('https://open.spotify.com/intl-pt/album/XYZ')).toEqual({ type: 'album', id: 'XYZ' });
    expect(parseSpotifyUrl('spotify:playlist:P1')).toEqual({ type: 'playlist', id: 'P1' });
    expect(parseSpotifyUrl('https://youtube.com/x')).toBeNull();
  });
  it('com credenciais: faixa, álbum e playlist viram buscas "artista - música"', async () => {
    const s = new SpotifyResolver('id', 'segredo', `${base}/v1`, `${base}/token`, `${base}/oembed`);
    const track = await s.resolve('https://open.spotify.com/track/T1', '1');
    expect(track.tracks[0]).toMatchObject({ title: 'Faixa', query: 'Alguém - Faixa', url: '', source: 'spotify' });
    const album = await s.resolve('https://open.spotify.com/album/A1', '1');
    expect(album.title).toBe('Álbum Teste');
    expect(album.tracks.map((x) => x.query)).toEqual(['Artista 1, Artista 2 - Música A', 'Artista 1 - Música B']);
    const pl = await s.resolve('spotify:playlist:P1', '1');
    expect(pl.tracks.map((x) => x.title)).toEqual(['Hino', 'Balada']);
    // O token é pedido uma vez e reutilizado; a API recebe Bearer.
    expect(hits.filter((h) => h.startsWith('POST /token'))).toHaveLength(1);
    expect(hits.find((h) => h.startsWith('GET /v1/albums'))).toContain('Bearer tk');
  });
  it('sem credenciais: faixa pelo oEmbed; álbum/playlist pedem credenciais', async () => {
    const s = new SpotifyResolver('', '', `${base}/v1`, `${base}/token`, `${base}/oembed`);
    const r = await s.resolve('https://open.spotify.com/track/T1', '1');
    expect(r.tracks[0]).toMatchObject({ title: 'Só o Nome', query: 'Só o Nome' });
    await expect(s.resolve('https://open.spotify.com/playlist/P1', '1')).rejects.toThrow(/SPOTIFY_CLIENT_ID/);
  });
});

// ─── Player com áudio de verdade (ffmpeg) e uma sala falsa ──────────────────

const until = async (fn: () => boolean, timeout = 5000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('player', () => {
  it('toca a fila inteira: quadros de 10 ms com áudio real, eventos e histórico de estado', async () => {
    const sink = new FakeSink();
    const opener = sineOpener(0.5);
    const started: string[] = [];
    const p = new MusicPlayer(
      opener,
      () => sink,
      async (x) => x,
      { onTrackStart: (x) => started.push(x.title) },
      100,
    );
    p.queue.add([t('um'), t('dois')]);
    p.start();
    await p.idle();
    expect(started).toEqual(['um', 'dois']);
    expect(sink.frames).toHaveLength(100); // 2 × 0,5 s em quadros de 10 ms
    expect(sink.frames[0].length).toBe(FRAME_BYTES / 2);
    const energy = sink.frames.slice(10, 40).reduce((s, f) => s + f.reduce((a, v) => a + Math.abs(v), 0), 0);
    expect(energy).toBeGreaterThan(0);
    expect(p.state).toBe('idle');
  });

  it('volume, pausa, continuar, pular e parar', async () => {
    const sink = new FakeSink(2);
    const p = new MusicPlayer(
      sineOpener(2),
      () => sink,
      async (x) => x,
      {},
      50,
    );
    p.queue.add([t('a'), t('b'), t('c')]);
    p.start();
    await until(() => sink.frames.length > 20);
    const peak = Math.max(...sink.frames.slice(5, 20).map((f) => Math.max(...f)));
    expect(peak).toBeLessThanOrEqual(2048); // tom do ffmpeg (~4096) a 50%

    expect(p.pause()).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    const paused = sink.frames.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(sink.frames.length).toBe(paused);
    expect(p.resume()).toBe(true);
    await until(() => sink.frames.length > paused + 5);

    expect(p.skip()).toBe(true);
    await until(() => p.queue.current?.title === 'b');
    expect(p.previous()?.title).toBe('a');
    await until(() => p.queue.current?.title === 'a' && p.positionMs > 0);
    p.stop();
    await p.idle();
    expect(p.queue.snapshot()).toEqual([]);
    expect(p.state).toBe('idle');
  });

  it('itens do Spotify são buscados na vez; falhas pulam para a próxima', async () => {
    const sink = new FakeSink();
    const opener = sineOpener(0.1);
    const errors: string[] = [];
    const p = new MusicPlayer(
      opener,
      () => sink,
      async (x) => (x.query === 'acha' ? t('achada') : null),
      { onError: (x) => errors.push(x.title) },
      100,
    );
    p.queue.add([
      t('spotify-1', { url: '', query: 'acha', source: 'spotify' }),
      t('spotify-2', { url: '', query: 'nada', source: 'spotify' }),
      t('ok'),
    ]);
    p.start();
    await p.idle();
    expect(opener.opened).toEqual(['achada', 'ok']);
    expect(errors).toEqual([]);
  });

  it('sem sala (sink nulo) o player para', async () => {
    const p = new MusicPlayer(
      sineOpener(0.2),
      () => null,
      async (x) => x,
      {},
      100,
    );
    p.queue.add([t('a')]);
    p.start();
    await p.idle();
    expect(p.state).toBe('idle');
  });

  it('embeds do player e da fila', () => {
    const p = new MusicPlayer(
      sineOpener(),
      () => null,
      async (x) => x,
      {},
      80,
    );
    expect(nowPlayingEmbed(p, null).description).toMatch(/Nada tocando/);
    p.queue.add([t('atual', { durationSeconds: 200, thumbnail: 'https://img/1.jpg' }), t('prox')]);
    p.queue.advance();
    p.state = 'playing';
    p.positionMs = 50_000;
    const e = nowPlayingEmbed(p, 'voz-1');
    expect(e.title).toBe('▶️ Tocando: atual');
    expect(e.description).toContain('`0:50 / 3:20`');
    expect(e.thumbnail?.url).toBe('https://img/1.jpg');
    expect(e.fields?.find((f) => f.name === 'A seguir')?.value).toContain('prox');
    expect(queueEmbed(p).footer?.text).toMatch(/1 música\(s\)/);
  });
});

describe('pipeline real yt-dlp → ffmpeg', () => {
  it('decodifica Opus/WebM (formato do YouTube) em PCM 48 kHz estéreo', async () => {
    const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const { ffmpegPath, YouTubeAudio } = await import('../src/services/music/audio.js');
    const dir = mkdtempSync(join(tmpdir(), 'ytdlp-'));
    const webm = join(dir, 'audio.webm');
    execFileSync(ffmpegPath(), [
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=1',
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      webm,
    ]);
    // "yt-dlp" falso: escreve o áudio na saída padrão, como o `-o -` do yt-dlp.
    const fake = join(dir, 'yt-dlp');
    writeFileSync(fake, `#!/usr/bin/env node\nprocess.stdout.write(require('fs').readFileSync(${JSON.stringify(webm)}));\n`);
    chmodSync(fake, 0o755);
    const audio = new YouTubeAudio(new YouTubeResolver(fake)).open(t('x'));
    let bytes = 0;
    for await (const chunk of audio.pcm as AsyncIterable<Buffer>) bytes += chunk.length;
    // ~1 s de áudio: 48000 amostras × 2 canais × 2 bytes (o Opus pode acrescentar alguns ms).
    expect(bytes).toBeGreaterThan(180_000);
    expect(bytes).toBeLessThan(200_000);
  });

  it('yt-dlp ausente: erro que explica como resolver', async () => {
    const yt = new YouTubeResolver('/caminho/que/nao/existe/yt-dlp');
    await expect(yt.search('x', '1')).rejects.toThrow(/Instale o yt-dlp ou defina YTDLP_PATH/);
  });
});

describe('conexão de voz', () => {
  /** Cliente Fluxer mínimo: o Gateway responde ao op 4 com a credencial, como o Fluxer. */
  function fakeClient() {
    const gateway = new EventEmitter() as EventEmitter & { updateVoiceState: (d: Record<string, unknown>) => void };
    const sent: Record<string, unknown>[] = [];
    let n = 0;
    gateway.updateVoiceState = (d) => {
      sent.push(d);
      if (d.channel_id) {
        const id = `conn-${++n}`;
        setTimeout(
          () =>
            gateway.emit('dispatch', 'VOICE_SERVER_UPDATE', {
              token: 't',
              endpoint: 'wss://x',
              connection_id: id,
              channel_id: d.channel_id,
              guild_id: 'g',
            }),
          5,
        );
      }
    };
    return { client: { guildId: 'g', gateway } as unknown as FluxerClient, sent };
  }

  it('dois pedidos ao mesmo tempo: uma entrada (op 4) e uma conexão LiveKit só', async () => {
    const { VoiceConnection } = await import('../src/services/music/voice.js');
    const { client, sent } = fakeClient();
    let sinks = 0;
    const voice = new VoiceConnection(client, async () => {
      sinks++;
      return new FakeSink();
    });
    const [a, b] = await Promise.all([voice.join('sala'), voice.join('sala')]);
    expect(a).toBe(b);
    expect(sinks).toBe(1);
    expect(sent.filter((d) => d.channel_id)).toHaveLength(1);
    // Trocar de sala sai da anterior (com o connection_id) antes de entrar na nova.
    await voice.join('outra');
    expect(sent.map((d) => d.channel_id ?? `sair:${d.connection_id}`)).toEqual(['sala', 'sair:conn-1', 'outra']);
    await voice.leave();
    expect(voice.channelId).toBeNull();
  });
});
