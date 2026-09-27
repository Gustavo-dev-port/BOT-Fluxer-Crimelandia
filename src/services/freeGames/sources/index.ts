import type { FreeGameSource } from '../types.js';
import { EpicFreeGamesSource } from './epic.js';
import { ItadGiveawaysSource } from './itadGiveaways.js';

export interface FreeGameSourceConfig {
  sources: readonly string[];
  country: string;
  itad: { apiKey: string; shops: readonly string[] };
  baseUrls?: Partial<Record<'epic' | 'itad', string>>;
}

export function buildFreeGameSources(cfg: FreeGameSourceConfig, warn: (msg: string) => void = () => undefined): FreeGameSource[] {
  const out: FreeGameSource[] = [];
  for (const source of cfg.sources) {
    if (source === 'epic') out.push(new EpicFreeGamesSource({ country: cfg.country, baseUrl: cfg.baseUrls?.epic }));
    else if (source === 'itad') {
      if (!cfg.itad.apiKey) {
        warn('ITAD_API_KEY vazio: jogos grátis da Steam e da GOG ficam de fora.');
        continue;
      }
      out.push(new ItadGiveawaysSource({ apiKey: cfg.itad.apiKey, shops: [...cfg.itad.shops], baseUrl: cfg.baseUrls?.itad }));
    } else warn(`fonte desconhecida em FREE_GAMES_SOURCES: ${source}`);
  }
  return out;
}
