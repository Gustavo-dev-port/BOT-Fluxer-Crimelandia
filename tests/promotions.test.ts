import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PromotionRepository } from '../src/database/promotionRepository.js';
import { formatMoney, promotionContent, promotionEmbed } from '../src/embeds/promotionEmbed.js';
import { buildAdapters } from '../src/services/promotions/adapters/index.js';
import { PromotionService, type PromotionPublisher, selectEligible } from '../src/services/promotions/promotionService.js';
import type { PromotionAdapter, PromotionOffer } from '../src/services/promotions/types.js';
import { resetDb } from './helpers.js';

const fixture = (name: string) => readFileSync(`tests/fixtures/promotions/${name}`, 'utf8');

// ─── Loja falsa servindo as respostas de exemplo ────────────────────────────

let server: Server;
let base = '';
const requests: { method: string; url: string; body: string; headers: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requests.push({ method: req.method!, url: req.url!, body, headers: req.headers });
    const url = new URL(req.url!, 'http://x');
    const routes: Record<string, string> = {
      '/steam/api/featuredcategories': 'steam.json',
      '/gog/v1/catalog': 'gog.json',
      '/humble/store/api/search': 'humble.json',
      '/epic/graphql': 'epic.json',
      '/itad/service/shops/v1': 'itad-shops.json',
      '/itad/deals/v2': 'itad-deals.json',
    };
    const file = routes[url.pathname];
    if (url.pathname === '/broken/api/featuredcategories') {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
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

const adapterConfig = (sources: string[], apiKey = 'chave-teste') => ({
  sources,
  country: 'BR',
  currency: 'BRL',
  minDiscount: 40,
  itad: { apiKey, shops: ['Nuuvem', 'Green Man Gaming'] },
  baseUrls: { steam: `${base}/steam`, gog: `${base}/gog`, humble: `${base}/humble`, epic: `${base}/epic`, itad: `${base}/itad` },
});

async function fetchFrom(source: string): Promise<PromotionOffer[]> {
  const [adapter] = buildAdapters(adapterConfig([source]));
  return adapter.fetchOffers();
}

describe('adaptadores (contra a loja falsa)', () => {
  it('Steam: preços em centavos, imagem, validade e link', async () => {
    const offers = await fetchFrom('steam');
    expect(offers).toHaveLength(3); // o item sem preço é descartado
    expect(offers[0]).toMatchObject({
      id: 'steam:1091500',
      title: 'Cyberpunk 2077',
      platform: 'Steam',
      oldPrice: 19999,
      currentPrice: 6999,
      currency: 'BRL',
      discount: 65,
      url: 'https://store.steampowered.com/app/1091500/',
    });
    expect(offers[0].expiresAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(requests.some((r) => r.url.includes('cc=BR'))).toBe(true);
  });

  it('GOG: lê "-80%" e calcula o desconto quando falta', async () => {
    const offers = await fetchFrom('gog');
    expect(offers.map((o) => [o.id, o.oldPrice, o.currentPrice, o.discount])).toEqual([
      ['gog:1207658924', 12999, 2599, 80],
      ['gog:1', 9999, 2999, 70],
    ]);
    expect(offers[0].url).toContain('gog.com');
  });

  it('Humble: aceita os dois formatos de preço', async () => {
    const offers = await fetchFrom('humble');
    expect(offers.map((o) => [o.title, o.oldPrice, o.currentPrice, o.currency, o.discount])).toEqual([
      ['Hades', 2499, 624, 'USD', 75],
      ['Celeste', 1999, 499, 'USD', 75],
    ]);
    expect(offers[0].url).toBe('https://www.humblebundle.com/store/hades');
  });

  it('Epic: GraphQL com onSale, imagem larga, slug da página e fim da oferta', async () => {
    const offers = await fetchFrom('epic');
    expect(offers[0]).toMatchObject({
      id: 'epic:a1b2c3',
      oldPrice: 29990,
      currentPrice: 7497,
      discount: 75,
      image: 'https://cdn1.epicgames.com/rdr2-wide.jpg',
      url: 'https://store.epicgames.com/pt-BR/p/red-dead-redemption-2',
    });
    expect(offers[0].expiresAt?.toISOString()).toBe('2030-01-01T16:00:00.000Z');
    expect(offers[1].url).toBe('https://store.epicgames.com/pt-BR/p/sem-pagina');
    const body = JSON.parse(requests.find((r) => r.url === '/epic/graphql')!.body);
    expect(body.variables).toMatchObject({ onSale: true, country: 'BR' });
  });

  it('IsThereAnyDeal: resolve lojas pelo nome e filtra por desconto mínimo', async () => {
    const offers = await fetchFrom('itad');
    expect(offers[0]).toMatchObject({ id: expect.stringMatching(/^itad:nuuvem:/), platform: 'Nuuvem', currency: 'BRL', discount: 95 });
    expect(offers[0].oldPrice).toBe(2990);
    expect(offers[0].currentPrice).toBe(149);
    const shops = requests.find((r) => r.url.startsWith('/itad/service/shops/v1'))!;
    expect(shops.headers['itad-api-key']).toBe('chave-teste');
    const deals = requests.find((r) => r.url.startsWith('/itad/deals/v2'))!;
    expect(deals.url).not.toContain('key=');
    expect(deals.headers['itad-api-key']).toBe('chave-teste');
    // "Green Man Gaming" casa com "GreenManGaming" da ITAD.
    expect(JSON.parse(deals.body)).toMatchObject({ country: 'BR', shops: [50, 36], filter: { cut: { min: 40, max: null } } });
  });

  it('sem ITAD_API_KEY a IsThereAnyDeal fica de fora com aviso', () => {
    const warnings: string[] = [];
    const adapters = buildAdapters(adapterConfig(['steam', 'itad', 'loja-x'], ''), (m) => warnings.push(m));
    expect(adapters.map((a) => a.name)).toEqual(['steam']);
    expect(warnings).toHaveLength(2);
  });
});

// ─── Regras do serviço ──────────────────────────────────────────────────────

const offer = (id: string, discount: number, currentPrice = 1000, extra: Partial<PromotionOffer> = {}): PromotionOffer => ({
  id,
  title: `Jogo ${id}`,
  platform: 'Steam',
  image: null,
  oldPrice: Math.round(currentPrice / (1 - discount / 100)),
  currentPrice,
  currency: 'BRL',
  discount,
  expiresAt: null,
  url: `https://loja/${id}`,
  ...extra,
});

class FakeAdapter implements PromotionAdapter {
  constructor(
    readonly name: string,
    public offers: PromotionOffer[] | Error,
  ) {}
  async fetchOffers() {
    if (this.offers instanceof Error) throw this.offers;
    return this.offers;
  }
}

class FakePublisher implements PromotionPublisher {
  posted: PromotionOffer[] = [];
  updated: PromotionOffer[] = [];
  channel: string | null = 'c-promo';
  async publishNew(o: PromotionOffer) {
    if (!this.channel) return null;
    this.posted.push(o);
    return { channelId: this.channel, messageId: `m-${o.id}` };
  }
  async publishUpdate(_stored: unknown, o: PromotionOffer) {
    this.updated.push(o);
  }
}

const silent = { info: () => undefined, warn: () => undefined };
const settings = { minDiscount: 40, maxPostsPerRun: 10, staleDays: 3 };

describe('PromotionService', () => {
  beforeEach(resetDb);

  it('publica só descontos ≥ 40%, sem duplicatas, do maior para o menor', async () => {
    const pub = new FakePublisher();
    const adapter = new FakeAdapter('a', [offer('x', 50), offer('y', 90), offer('z', 39), offer('x', 60)]);
    const svc = new PromotionService([adapter], new PromotionRepository(), pub, settings, silent);
    const report = await svc.sync();
    expect(pub.posted.map((o) => [o.id, o.discount])).toEqual([
      ['y', 90],
      ['x', 60],
    ]);
    expect(report).toMatchObject({ fetched: 4, eligible: 2, posted: 2, updated: 0 });
  });

  it('não repete a mesma promoção e atualiza quando o preço muda', async () => {
    const pub = new FakePublisher();
    const adapter = new FakeAdapter('a', [offer('x', 50, 1000)]);
    const svc = new PromotionService([adapter], new PromotionRepository(), pub, settings, silent);
    await svc.sync();
    await svc.sync();
    expect(pub.posted).toHaveLength(1);
    expect(pub.updated).toHaveLength(0);

    adapter.offers = [offer('x', 70, 600)];
    const report = await svc.sync();
    expect(report?.updated).toBe(1);
    expect(pub.updated[0].currentPrice).toBe(600);
    expect(await prisma.promotion.findUniqueOrThrow({ where: { id: 'x' } })).toMatchObject({
      currentPrice: 600,
      discount: 70,
      messageId: 'm-x',
    });
  });

  it('limita postagens por rodada e publica o resto na próxima', async () => {
    const pub = new FakePublisher();
    const offers = Array.from({ length: 5 }, (_, i) => offer(`p${i}`, 50 + i));
    const svc = new PromotionService(
      [new FakeAdapter('a', offers)],
      new PromotionRepository(),
      pub,
      { ...settings, maxPostsPerRun: 2 },
      silent,
    );
    expect((await svc.sync())?.deferred).toBe(3);
    await svc.sync();
    await svc.sync();
    expect(pub.posted).toHaveLength(5);
    expect(new Set(pub.posted.map((o) => o.id)).size).toBe(5);
  });

  it('uma loja com erro não impede as outras', async () => {
    const pub = new FakePublisher();
    const svc = new PromotionService(
      [new FakeAdapter('quebrada', new Error('HTTP 403')), new FakeAdapter('ok', [offer('k', 80)])],
      new PromotionRepository(),
      pub,
      settings,
      silent,
    );
    const report = await svc.sync();
    expect(report?.failedSources).toEqual([{ source: 'quebrada', error: 'HTTP 403' }]);
    expect(pub.posted.map((o) => o.id)).toEqual(['k']);
  });

  it('sem canal configurado, nada é marcado como visto (publica quando o canal existir)', async () => {
    const pub = new FakePublisher();
    pub.channel = null;
    const svc = new PromotionService([new FakeAdapter('a', [offer('x', 50)])], new PromotionRepository(), pub, settings, silent);
    expect((await svc.sync())?.deferred).toBe(1);
    expect(await prisma.promotion.count()).toBe(0);
    pub.channel = 'c-promo';
    await svc.sync();
    expect(pub.posted).toHaveLength(1);
  });

  it('ignora ofertas vencidas e encerra as que expiraram', async () => {
    const pub = new FakePublisher();
    const now = new Date('2030-06-01T00:00:00Z');
    const adapter = new FakeAdapter('a', [
      offer('velha', 60, 1000, { expiresAt: new Date('2030-05-01T00:00:00Z') }),
      offer('boa', 60, 1000, { expiresAt: new Date('2030-06-02T00:00:00Z') }),
    ]);
    const svc = new PromotionService([adapter], new PromotionRepository(), pub, settings, silent);
    await svc.sync(now);
    expect(pub.posted.map((o) => o.id)).toEqual(['boa']);
    const report = await svc.sync(new Date('2030-06-03T00:00:00Z'));
    expect(report?.ended).toBe(1);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: 'boa' } })).active).toBe(false);
  });

  it('selectEligible descarta desconto impossível e preço que não caiu', () => {
    expect(selectEligible([offer('a', 101), { ...offer('b', 50), currentPrice: 5000, oldPrice: 5000 }], 40)).toEqual([]);
  });
});

describe('embed de promoção', () => {
  it('mostra preços em reais, desconto, validade e link "Ver oferta"', () => {
    const e = promotionEmbed(offer('x', 80, 999, { expiresAt: new Date('2030-01-01T00:00:00Z'), image: 'https://img' }));
    expect(e.title).toBe('🟢 NOVA PROMOÇÃO');
    expect(e.description).toContain('De: ~~R$');
    expect(e.description).toContain('Por: **R$');
    expect(e.description).toContain('Desconto: **-80%**');
    expect(e.description).toContain('<t:1893456000:f>');
    expect(e.description).toContain('[Ver oferta](https://loja/x)');
    expect(e.image?.url).toBe('https://img');
    expect(promotionEmbed(offer('x', 80), 'update').title).toBe('🔄 PREÇO ATUALIZADO');
  });

  it('menciona o cargo só a partir de 80%', () => {
    expect(promotionContent(offer('x', 80), '123', 80)).toContain('<@&123>');
    expect(promotionContent(offer('x', 79), '123', 80)).toBeUndefined();
    expect(promotionContent(offer('x', 95), null, 80)).toBeUndefined();
  });

  it('formata moedas', () => {
    expect(formatMoney(2990, 'BRL').replace(/\s/g, ' ')).toBe('R$ 29,90');
    expect(formatMoney(499, 'USD')).toContain('4,99');
  });
});
