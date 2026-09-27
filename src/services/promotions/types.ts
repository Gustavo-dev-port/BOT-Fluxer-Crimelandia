/** Formato comum que todo adaptador de loja devolve. */
export interface PromotionOffer {
  /** Único por loja: "<plataforma>:<id na loja>". */
  id: string;
  title: string;
  platform: string;
  image: string | null;
  /** Preço cheio, em centavos. */
  oldPrice: number;
  /** Preço com desconto, em centavos. */
  currentPrice: number;
  currency: string;
  /** 0–100 */
  discount: number;
  expiresAt: Date | null;
  url: string;
}

export interface PromotionAdapter {
  /** Nome curto usado em PROMO_SOURCES e nos logs (ex.: "steam"). */
  readonly name: string;
  fetchOffers(): Promise<PromotionOffer[]>;
}
