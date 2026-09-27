/**
 * Giveaways pela API oficial da IsThereAnyDeal (GET /giveaways/v1, chave no cabeçalho ITAD-API-Key):
 * cobre jogos grátis na Steam e na GOG (e free weekends que a ITAD lista).
 * → [{ id, title, shop: { name }, url, details, publish, expiry, note, games: [{ title, assets }] }]
 */
import { asArray, fetchJson, isObject, str, toDate } from '../../../utils/http.js';
import type { FreeGameOffer, FreeGameSource } from '../types.js';

const shopKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export class ItadGiveawaysSource implements FreeGameSource {
  readonly name = 'itad';

  constructor(private readonly opts: { apiKey: string; shops: string[]; baseUrl?: string }) {}

  async fetchFreeGames(now: Date): Promise<FreeGameOffer[]> {
    const base = this.opts.baseUrl ?? 'https://api.isthereanydeal.com';
    // A chave vai só no cabeçalho, para nunca aparecer em URLs de log.
    const data = await fetchJson(`${base}/giveaways/v1?limit=50&sort=-publish`, { headers: { 'ITAD-API-Key': this.opts.apiKey } });
    const wanted = new Set(this.opts.shops.map(shopKey));
    return asArray(data)
      .filter(isObject)
      .flatMap((g) => parseItadGiveaway(g, now))
      .filter((g) => wanted.size === 0 || wanted.has(shopKey(g.platform)));
  }
}

/** "X Free Weekend on Steam", "Play free this weekend"… */
const WEEKEND = /free\s*weekend|this\s*weekend|fim\s*de\s*semana/i;

export function parseItadGiveaway(g: Record<string, unknown>, now: Date): FreeGameOffer[] {
  const id = str(g.id);
  const rawTitle = str(g.title);
  const shop = isObject(g.shop) ? str(g.shop.name) : null;
  const url = str(g.url) ?? str(g.details);
  if (!id || !rawTitle || !shop || !url) return [];
  const endsAt = toDate(g.expiry);
  if (endsAt && endsAt <= now) return [];
  const game = asArray(g.games).find(isObject);
  const assets = game && isObject(game.assets) ? game.assets : {};
  const note = str(g.note);
  // O título da ITAD vem como "Jogo - Free on GOG"; preferimos o nome do jogo.
  const title = (game && str(game.title)) ?? rawTitle.replace(/\s*[-–]\s*free\b.*$/i, '');
  const weekend = WEEKEND.test(`${rawTitle} ${note ?? ''}`);
  return [
    {
      id: `itad:${id}`,
      title,
      platform: shop,
      kind: weekend ? 'free-weekend' : 'free',
      description: note,
      image: str(assets.banner600) ?? str(assets.banner400) ?? str(assets.boxart),
      url,
      startsAt: toDate(g.publish),
      endsAt,
    },
  ];
}
