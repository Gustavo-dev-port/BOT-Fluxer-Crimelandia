/**
 * IsThereAnyDeal (API oficial, https://docs.isthereanydeal.com): usada para lojas
 * sem API pública própria, como Nuuvem e Green Man Gaming.
 * - GET  /service/shops/v1?country=BR → [{ id, title }] (resolve nomes em IDs)
 * - POST /deals/v2 (cabeçalho ITAD-API-Key) { country, shops, limit, sort, filter: { cut: { min, max } } }
 *   → list[]: id, title, assets.banner400, deal.{shop, price, regular, cut, expiry, url}
 */
import { asArray, fetchJson, isObject, num, str, toCents, toDate } from '../../../utils/http.js';
import type { PromotionAdapter, PromotionOffer } from '../types.js';

export interface ItadOptions {
  apiKey: string;
  country: string;
  /** Nomes das lojas como a ITAD chama (ex.: "Nuuvem", "GreenManGaming"). */
  shops: string[];
  minDiscount: number;
  baseUrl?: string;
}

/** Compara nomes de loja ignorando espaços, maiúsculas e pontuação. */
const shopKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export class ItadAdapter implements PromotionAdapter {
  readonly name = 'itad';
  private shopIds: number[] | null = null;

  constructor(private readonly opts: ItadOptions) {}

  private get base() {
    return this.opts.baseUrl ?? 'https://api.isthereanydeal.com';
  }

  private async resolveShops(): Promise<number[]> {
    if (this.shopIds) return this.shopIds;
    const data = await fetchJson(`${this.base}/service/shops/v1?country=${this.opts.country}`, {
      headers: { 'ITAD-API-Key': this.opts.apiKey },
    });
    const wanted = new Set(this.opts.shops.map(shopKey));
    this.shopIds = asArray(data)
      .filter(isObject)
      .filter((s) => {
        const title = str(s.title);
        return title !== null && wanted.has(shopKey(title));
      })
      .map((s) => num(s.id))
      .filter((id): id is number => id !== null);
    return this.shopIds;
  }

  async fetchOffers(): Promise<PromotionOffer[]> {
    const shops = await this.resolveShops();
    if (shops.length === 0) return [];
    // A chave vai só no cabeçalho, para nunca aparecer em URLs de log.
    const data = await fetchJson(`${this.base}/deals/v2`, {
      method: 'POST',
      headers: { 'ITAD-API-Key': this.opts.apiKey },
      body: {
        country: this.opts.country,
        shops,
        limit: 100,
        sort: '-cut',
        filter: { cut: { min: this.opts.minDiscount, max: null } },
      },
    });
    const list = isObject(data) ? asArray(data.list) : [];
    return list.flatMap((item) => (isObject(item) ? parseItadDeal(item) : []));
  }
}

export function parseItadDeal(item: Record<string, unknown>): PromotionOffer[] {
  const gameId = str(item.id);
  const title = str(item.title);
  const deal = isObject(item.deal) ? item.deal : null;
  const shop = deal && isObject(deal.shop) ? deal.shop : null;
  const price = deal && isObject(deal.price) ? deal.price : null;
  const regular = deal && isObject(deal.regular) ? deal.regular : null;
  const shopName = str(shop?.name);
  const url = str(deal?.url);
  const currentPrice = num(price?.amountInt) ?? toCents(price?.amount);
  const oldPrice = num(regular?.amountInt) ?? toCents(regular?.amount);
  const discount = num(deal?.cut);
  if (!gameId || !title || !shopName || !url || currentPrice === null || oldPrice === null || discount === null) return [];
  const assets = isObject(item.assets) ? item.assets : {};
  return [
    {
      // Um mesmo jogo pode estar em promoção em lojas diferentes.
      id: `itad:${shopKey(shopName)}:${gameId}`,
      title,
      platform: shopName,
      image: str(assets.banner400) ?? str(assets.banner600) ?? str(assets.boxart),
      oldPrice,
      currentPrice,
      currency: str(price?.currency) ?? 'BRL',
      discount,
      expiresAt: toDate(deal?.expiry),
      url,
    },
  ];
}
