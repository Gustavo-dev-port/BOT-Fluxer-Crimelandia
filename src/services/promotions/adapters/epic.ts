/**
 * Epic Games Store: jogos em promoção pela GraphQL pública da loja.
 * POST https://store.epicgames.com/graphql (searchStore com onSale: true)
 * → Catalog.searchStore.elements[]: id, title, keyImages, offerMappings/catalogNs (slug da página),
 *   price.totalPrice.{originalPrice, discountPrice, currencyCode} (em centavos) e
 *   price.lineOffers[].appliedRules[].endDate.
 * Observação: a Epic às vezes bloqueia chamadas automáticas; nesse caso o erro é
 * registrado e as outras lojas seguem normalmente.
 */
import { asArray, discountFrom, fetchJson, isObject, num, str, toDate } from '../http.js';
import type { PromotionAdapter, PromotionOffer } from '../types.js';

const QUERY = `query searchStoreQuery($country: String!, $locale: String, $count: Int, $onSale: Boolean, $sortBy: String, $sortDir: String) {
  Catalog {
    searchStore(country: $country, locale: $locale, count: $count, onSale: $onSale, sortBy: $sortBy, sortDir: $sortDir, category: "games/edition/base") {
      elements {
        id
        title
        productSlug
        urlSlug
        keyImages { type url }
        offerMappings { pageSlug pageType }
        catalogNs { mappings(pageType: "productHome") { pageSlug pageType } }
        price(country: $country) {
          totalPrice { discountPrice originalPrice currencyCode }
          lineOffers { appliedRules { endDate } }
        }
      }
    }
  }
}`;

export class EpicAdapter implements PromotionAdapter {
  readonly name = 'epic';

  constructor(private readonly opts: { country: string; baseUrl?: string; count?: number }) {}

  async fetchOffers(): Promise<PromotionOffer[]> {
    const base = this.opts.baseUrl ?? 'https://store.epicgames.com';
    const data = await fetchJson(`${base}/graphql`, {
      method: 'POST',
      body: {
        query: QUERY,
        variables: {
          country: this.opts.country,
          locale: 'pt-BR',
          count: this.opts.count ?? 40,
          onSale: true,
          sortBy: 'currentPrice',
          sortDir: 'ASC',
        },
      },
    });
    const catalog = isObject(data) && isObject(data.data) && isObject(data.data.Catalog) ? data.data.Catalog : null;
    const search = catalog && isObject(catalog.searchStore) ? catalog.searchStore : null;
    return asArray(search?.elements).flatMap((e) => (isObject(e) ? parseEpicElement(e) : []));
  }
}

/** Imagem preferida: paisagem primeiro. */
export function epicImage(keyImages: unknown): string | null {
  const images = asArray(keyImages).filter(isObject);
  for (const type of ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'OfferImageTall']) {
    const hit = images.find((i) => i.type === type);
    const url = hit ? str(hit.url) : null;
    if (url) return url;
  }
  return null;
}

export function epicSlug(e: Record<string, unknown>): string | null {
  const fromMappings = (v: unknown) =>
    asArray(v)
      .filter(isObject)
      .map((m) => str(m.pageSlug))
      .find(Boolean) ?? null;
  const ns = isObject(e.catalogNs) ? e.catalogNs.mappings : undefined;
  const slug = fromMappings(e.offerMappings) ?? fromMappings(ns) ?? str(e.productSlug) ?? str(e.urlSlug);
  return slug ? slug.replace(/\/home$/, '') : null;
}

export function parseEpicElement(e: Record<string, unknown>): PromotionOffer[] {
  const id = str(e.id);
  const title = str(e.title);
  const price = isObject(e.price) ? e.price : null;
  const total = price && isObject(price.totalPrice) ? price.totalPrice : null;
  const oldPrice = num(total?.originalPrice);
  const currentPrice = num(total?.discountPrice);
  if (!id || !title || oldPrice === null || currentPrice === null) return [];
  const endDate = asArray(price?.lineOffers)
    .filter(isObject)
    .flatMap((o) => asArray(o.appliedRules))
    .filter(isObject)
    .map((r) => toDate(r.endDate))
    .find((d): d is Date => d !== null);
  const slug = epicSlug(e);
  return [
    {
      id: `epic:${id}`,
      title,
      platform: 'Epic Games',
      image: epicImage(e.keyImages),
      oldPrice,
      currentPrice,
      currency: str(total?.currencyCode) ?? 'BRL',
      discount: discountFrom(oldPrice, currentPrice),
      expiresAt: endDate ?? null,
      url: slug
        ? `https://store.epicgames.com/pt-BR/p/${slug}`
        : 'https://store.epicgames.com/pt-BR/browse?sortBy=currentPrice&sortDir=ASC&priceTier=tierDiscouted',
    },
  ];
}
