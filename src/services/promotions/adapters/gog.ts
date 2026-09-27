/**
 * GOG: catálogo público ordenado por desconto.
 * GET https://catalog.gog.com/v1/catalog?order=desc:discount&discounted=eq:true&countryCode=BR&currencyCode=BRL&locale=pt-BR
 * → products[]: id, title, storeLink, coverHorizontal, price.{baseMoney,finalMoney}.amount e price.discount ("-80%").
 */
import { asArray, discountFrom, fetchJson, isObject, num, str, toCents } from '../../../utils/http.js';
import type { PromotionAdapter, PromotionOffer } from '../types.js';

export class GogAdapter implements PromotionAdapter {
  readonly name = 'gog';

  constructor(private readonly opts: { country: string; currency: string; baseUrl?: string; limit?: number }) {}

  async fetchOffers(): Promise<PromotionOffer[]> {
    const base = this.opts.baseUrl ?? 'https://catalog.gog.com';
    const params = new URLSearchParams({
      limit: String(this.opts.limit ?? 48),
      order: 'desc:discount',
      discounted: 'eq:true',
      productType: 'in:game,pack',
      countryCode: this.opts.country,
      currencyCode: this.opts.currency,
      locale: 'pt-BR',
    });
    const data = await fetchJson(`${base}/v1/catalog?${params}`);
    const products = isObject(data) ? asArray(data.products) : [];
    return products.flatMap((p) => (isObject(p) ? parseGogProduct(p, this.opts.currency) : []));
  }
}

export function parseGogProduct(p: Record<string, unknown>, fallbackCurrency: string): PromotionOffer[] {
  const id = str(p.id);
  const title = str(p.title);
  const price = isObject(p.price) ? p.price : null;
  if (!id || !title || !price) return [];
  const base = isObject(price.baseMoney) ? price.baseMoney : null;
  const final = isObject(price.finalMoney) ? price.finalMoney : null;
  const oldPrice = toCents(base?.amount);
  const currentPrice = toCents(final?.amount);
  if (oldPrice === null || currentPrice === null) return [];
  // "-80%" → 80; se não vier, calcula pelos preços.
  const discountText = str(price.discount);
  const parsed = discountText ? num(discountText.replace(/[^\d.]/g, '')) : null;
  const slug = str(p.slug);
  return [
    {
      id: `gog:${id}`,
      title,
      platform: 'GOG',
      image: str(p.coverHorizontal) ?? str(p.coverVertical),
      oldPrice,
      currentPrice,
      currency: str(final?.currency) ?? fallbackCurrency,
      discount: parsed ?? discountFrom(oldPrice, currentPrice),
      expiresAt: null,
      url: str(p.storeLink) ?? (slug ? `https://www.gog.com/game/${slug}` : 'https://www.gog.com/games?discounted=true'),
    },
  ];
}
