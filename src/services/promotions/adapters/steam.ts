/**
 * Steam: ofertas em destaque da loja.
 * GET https://store.steampowered.com/api/featuredcategories?cc=BR&l=portuguese
 * → specials.items[]: id, name, discount_percent, original_price e final_price
 *   (em centavos), currency, large_capsule_image/header_image, discount_expiration (Unix).
 */
import { asArray, fetchJson, isObject, num, str, toDate } from '../../../utils/http.js';
import type { PromotionAdapter, PromotionOffer } from '../types.js';

export class SteamAdapter implements PromotionAdapter {
  readonly name = 'steam';

  constructor(private readonly opts: { country: string; baseUrl?: string }) {}

  async fetchOffers(): Promise<PromotionOffer[]> {
    const base = this.opts.baseUrl ?? 'https://store.steampowered.com';
    const data = await fetchJson(`${base}/api/featuredcategories?cc=${this.opts.country}&l=portuguese`);
    const items = isObject(data) && isObject(data.specials) ? asArray(data.specials.items) : [];
    return items.flatMap((item) => (isObject(item) ? parseSteamItem(item) : []));
  }
}

export function parseSteamItem(item: Record<string, unknown>): PromotionOffer[] {
  const id = str(item.id);
  const title = str(item.name);
  const oldPrice = num(item.original_price);
  const currentPrice = num(item.final_price);
  const discount = num(item.discount_percent);
  if (!id || !title || oldPrice === null || currentPrice === null || discount === null) return [];
  return [
    {
      id: `steam:${id}`,
      title,
      platform: 'Steam',
      image: str(item.large_capsule_image) ?? str(item.header_image),
      oldPrice,
      currentPrice,
      currency: str(item.currency) ?? 'BRL',
      discount,
      expiresAt: toDate(item.discount_expiration),
      url: `https://store.steampowered.com/app/${id}/`,
    },
  ];
}
