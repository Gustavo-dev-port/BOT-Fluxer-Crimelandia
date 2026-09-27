import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/client.js';
import { FreeGameRepository } from '../src/database/freeGameRepository.js';
import { freeGameEmbed } from '../src/embeds/freeGameEmbed.js';
import { FreeGameService, type FreeGamePublisher, selectCurrent } from '../src/services/freeGames/freeGameService.js';
import { buildFreeGameSources } from '../src/services/freeGames/sources/index.js';
import type { FreeGameOffer, FreeGameSource } from '../src/services/freeGames/types.js';
import { resetDb } from './helpers.js';

const NOW = new Date('2030-06-01T12:00:00Z');
const fixture = (name: string) => readFileSync(`tests/fixtures/freegames/${name}`, 'utf8');

let server: Server;
let base = '';
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url!);
    const path = new URL(req.url!, 'http://x').pathname;
    const file = { '/epic/freeGamesPromotions': 'epic-free.json', '/itad/giveaways/v1': 'itad-giveaways.json' }[path];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fixture(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

const sources = (names: string[], apiKey = 'chave') =>
  buildFreeGameSources({
    sources: names,
    country: 'BR',
    itad: { apiKey, shops: ['Steam', 'GOG'] },
    baseUrls: { epic: `${base}/epic`, itad: `${base}/itad` },
  });

describe('fontes de jogos grátis', () => {
  it('Epic: só o que está grátis agora (ignora próximos e descontos parciais)', async () => {
    const [epic] = sources(['epic']);
    const games = await epic.fetchFreeGames(NOW);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      id: 'epic:ds1',
      title: 'Death Stranding',
      platform: 'Epic Games',
      kind: 'free',
      description: 'Do lendário criador Hideo Kojima.',
      image: 'https://cdn1.epicgames.com/ds-wide.jpg',
      url: 'https://store.epicgames.com/pt-BR/p/death-stranding',
    });
    expect(games[0].endsAt?.toISOString()).toBe('2030-06-06T15:00:00.000Z');
    expect(requests.some((u) => u.includes('country=BR'))).toBe(true);
  });

  it('IsThereAnyDeal: GOG e Steam, marca Free Weekend, ignora vencidos e outras lojas', async () => {
    const [itad] = sources(['itad']);
    const games = await itad.fetchFreeGames(NOW);
    expect(games.map((g) => [g.title, g.platform, g.kind])).toEqual([
      ['State of Mind', 'GOG', 'free'],
      ['Hunt: Showdown', 'Steam', 'free-weekend'],
    ]);
    expect(games[0].image).toContain('banner600');
    expect(requests.some((u) => u.startsWith('/itad/giveaways/v1') && !u.includes('key='))).toBe(true);
  });

  it('sem ITAD_API_KEY só a Epic fica ativa', () => {
    const warnings: string[] = [];
    const list = buildFreeGameSources({ sources: ['epic', 'itad'], country: 'BR', itad: { apiKey: '', shops: [] } }, (m) =>
      warnings.push(m),
    );
    expect(list.map((s) => s.name)).toEqual(['epic']);
    expect(warnings[0]).toMatch(/ITAD_API_KEY/);
  });
});

const game = (id: string, extra: Partial<FreeGameOffer> = {}): FreeGameOffer => ({
  id,
  title: `Jogo ${id}`,
  platform: 'Epic Games',
  kind: 'free',
  description: null,
  image: null,
  url: `https://loja/${id}`,
  startsAt: null,
  endsAt: new Date('2030-06-05T00:00:00Z'),
  ...extra,
});

class FakeSource implements FreeGameSource {
  constructor(
    readonly name: string,
    public games: FreeGameOffer[] | Error,
  ) {}
  async fetchFreeGames() {
    if (this.games instanceof Error) throw this.games;
    return this.games;
  }
}

class FakePublisher implements FreeGamePublisher {
  posted: FreeGameOffer[] = [];
  channel: string | null = 'c-gratis';
  async publishNew(g: FreeGameOffer) {
    if (!this.channel) return null;
    this.posted.push(g);
    return { channelId: this.channel, messageId: `m-${g.id}` };
  }
}

const silent = { info: () => undefined, warn: () => undefined };
const settings = { maxPostsPerRun: 10, staleDays: 2 };

describe('FreeGameService', () => {
  beforeEach(resetDb);

  it('publica uma vez só e evita duplicatas entre fontes', async () => {
    const pub = new FakePublisher();
    const svc = new FreeGameService(
      [new FakeSource('a', [game('x'), game('y')]), new FakeSource('b', [game('x')])],
      new FreeGameRepository(),
      pub,
      settings,
      silent,
    );
    expect((await svc.sync(NOW))?.posted).toBe(2);
    await svc.sync(NOW);
    expect(pub.posted.map((g) => g.id).sort()).toEqual(['x', 'y']);
  });

  it('não publica vencidos nem os que ainda não começaram', () => {
    const current = selectCurrent(
      [
        game('ok'),
        game('vencido', { endsAt: new Date('2030-05-01T00:00:00Z') }),
        game('futuro', { startsAt: new Date('2030-07-01T00:00:00Z') }),
      ],
      NOW,
    );
    expect(current.map((g) => g.id)).toEqual(['ok']);
  });

  it('encerra quando passa do prazo e !gratis lista só os ativos', async () => {
    const pub = new FakePublisher();
    const repo = new FreeGameRepository();
    const svc = new FreeGameService(
      [new FakeSource('a', [game('curto', { endsAt: new Date('2030-06-02T00:00:00Z') }), game('longo')])],
      repo,
      pub,
      settings,
      silent,
    );
    await svc.sync(NOW);
    expect((await repo.listActive(NOW)).map((g) => g.id)).toEqual(['curto', 'longo']);
    const later = new Date('2030-06-03T00:00:00Z');
    expect((await svc.sync(later))?.ended).toBe(1);
    expect((await repo.listActive(later)).map((g) => g.id)).toEqual(['longo']);
  });

  it('fonte com erro não impede as outras; sem canal nada é marcado como visto', async () => {
    const pub = new FakePublisher();
    pub.channel = null;
    const svc = new FreeGameService(
      [new FakeSource('ruim', new Error('HTTP 403')), new FakeSource('boa', [game('x')])],
      new FreeGameRepository(),
      pub,
      settings,
      silent,
    );
    const report = await svc.sync(NOW);
    expect(report).toMatchObject({ posted: 0, deferred: 1, failedSources: [{ source: 'ruim', error: 'HTTP 403' }] });
    expect(await prisma.freeGame.count()).toBe(0);
    pub.channel = 'c-gratis';
    await svc.sync(NOW);
    expect(pub.posted.map((g) => g.id)).toEqual(['x']);
  });
});

describe('embed de jogo grátis', () => {
  it('tem imagem, nome, descrição, plataforma, prazo e link "Resgatar"', () => {
    const e = freeGameEmbed(game('x', { description: 'Um ótimo jogo.', image: 'https://img', endsAt: new Date('2030-01-01T00:00:00Z') }));
    expect(e.title).toBe('🎁 JOGO GRÁTIS');
    expect(e.image?.url).toBe('https://img');
    expect(e.description).toContain('Um ótimo jogo.');
    expect(e.description).toContain('Epic Games');
    expect(e.description).toContain('<t:1893456000:f>');
    expect(e.description).toContain('[Resgatar](https://loja/x)');
    expect(freeGameEmbed(game('w', { kind: 'free-weekend' })).title).toBe('🎮 FREE WEEKEND');
  });
});
