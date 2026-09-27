/**
 * Epic Games: jogos grátis da semana.
 * GET https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR
 * → data.Catalog.searchStore.elements[]: title, description, keyImages, slugs e
 *   promotions.promotionalOffers[].promotionalOffers[] { startDate, endDate, discountSetting.discountPercentage }.
 * Grátis agora = oferta vigente com discountPercentage 0 (100% de desconto).
 */
import { asArray, fetchJson, isObject, num, str, toDate } from '../../../utils/http.js';
import { epicImage, epicSlug } from '../../promotions/adapters/epic.js';
import type { FreeGameOffer, FreeGameSource } from '../types.js';

export class EpicFreeGamesSource implements FreeGameSource {
  readonly name = 'epic';

  constructor(private readonly opts: { country: string; baseUrl?: string }) {}

  async fetchFreeGames(now: Date): Promise<FreeGameOffer[]> {
    const base = this.opts.baseUrl ?? 'https://store-site-backend-static.ak.epicgames.com';
    const c = this.opts.country;
    const data = await fetchJson(`${base}/freeGamesPromotions?locale=pt-BR&country=${c}&allowCountries=${c}`);
    const catalog = isObject(data) && isObject(data.data) && isObject(data.data.Catalog) ? data.data.Catalog : null;
    const search = catalog && isObject(catalog.searchStore) ? catalog.searchStore : null;
    return asArray(search?.elements).flatMap((e) => (isObject(e) ? parseEpicFreeGame(e, now) : []));
  }
}

export function parseEpicFreeGame(e: Record<string, unknown>, now: Date): FreeGameOffer[] {
  const id = str(e.id);
  const title = str(e.title);
  if (!id || !title) return [];
  const promotions = isObject(e.promotions) ? e.promotions : null;
  const current = asArray(promotions?.promotionalOffers)
    .filter(isObject)
    .flatMap((group) => asArray(group.promotionalOffers))
    .filter(isObject)
    .find((offer) => {
      const setting = isObject(offer.discountSetting) ? offer.discountSetting : null;
      const start = toDate(offer.startDate);
      const end = toDate(offer.endDate);
      return num(setting?.discountPercentage) === 0 && (!start || start <= now) && (!end || end > now);
    });
  if (!current) return [];
  const slug = epicSlug(e);
  return [
    {
      id: `epic:${id}`,
      title,
      platform: 'Epic Games',
      kind: 'free',
      description: str(e.description),
      image: epicImage(e.keyImages),
      url: slug ? `https://store.epicgames.com/pt-BR/p/${slug}` : 'https://store.epicgames.com/pt-BR/free-games',
      startsAt: toDate(current.startDate),
      endsAt: toDate(current.endDate),
    },
  ];
}
