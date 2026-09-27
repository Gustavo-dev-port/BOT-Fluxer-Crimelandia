/**
 * Humble Store: busca de itens em promoção.
 * GET https://www.humblebundle.com/store/api/search?sort=discount&filter=onsale&page=0&request=1
 * → results[]: machine_name, human_name, human_url, full_price e current_price
 *   ({amount, currency} ou [amount, currency]), large_capsule/featured_image, sale_end (Unix).
 */
import { asArray, discountFrom, fetchJson, isObject, num, str, toCents, toDate } from '../../../utils/http.js';
import type { PromotionAdapter, PromotionOffer } from '../types.js';

export class HumbleAdapter implements PromotionAdapter {
  readonly name = 'humble';

  constructor(private readonly opts: { baseUrl?: string } = {}) {}

  async fetchOffers(): Promise<PromotionOffer[]> {
    const base = this.opts.baseUrl ?? 'https://www.humblebundle.com';
    const data = await fetchJson(`${base}/store/api/search?sort=discount&filter=onsale&page=0&request=1`);
    const results = isObject(data) ? asArray(data.results) : [];
    return results.flatMap((r) => (isObject(r) ? parseHumbleResult(r) : []));
  }
}

/** A Humble já usou os dois formatos de preço. */
function readMoney(v: unknown): { cents: number; currency: string | null } | null {
  if (isObject(v)) {
    const cents = toCents(v.amount);
    return cents === null ? null : { cents, currency: str(v.currency) };
  }
  if (Array.isArray(v)) {
    const cents = toCents(v[0]);
    return cents === null ? null : { cents, currency: str(v[1]) };
  }
  return null;
}

export function parseHumbleResult(r: Record<string, unknown>): PromotionOffer[] {
  const id = str(r.machine_name);
  const title = str(r.human_name);
  const full = readMoney(r.full_price);
  const current = readMoney(r.current_price);
  if (!id || !title || !full || !current) return [];
  const slug = str(r.human_url);
  return [
    {
      id: `humble:${id}`,
      title,
      platform: 'Humble Bundle',
      image: str(r.large_capsule) ?? str(r.featured_image) ?? str(r.standard_carousel_image),
      oldPrice: full.cents,
      currentPrice: current.cents,
      currency: current.currency ?? full.currency ?? 'USD',
      discount: num(r.discount_percentage) ?? discountFrom(full.cents, current.cents),
      expiresAt: toDate(r.sale_end),
      url: slug ? `https://www.humblebundle.com/store/${slug}` : 'https://www.humblebundle.com/store',
    },
  ];
}
