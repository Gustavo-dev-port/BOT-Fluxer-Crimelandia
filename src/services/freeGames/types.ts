/** Formato comum das fontes de jogos grátis. */
export interface FreeGameOffer {
  /** Único por fonte: "<fonte>:<id>". */
  id: string;
  title: string;
  platform: string;
  /** "free": grátis para resgatar e manter. "free-weekend": jogar grátis por tempo limitado. */
  kind: 'free' | 'free-weekend';
  description: string | null;
  image: string | null;
  url: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface FreeGameSource {
  readonly name: string;
  fetchFreeGames(now: Date): Promise<FreeGameOffer[]>;
}
