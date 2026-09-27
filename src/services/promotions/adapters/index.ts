/** Monta os adaptadores de loja ativos a partir da configuração. */
import type { PromotionAdapter } from '../types.js';
import { EpicAdapter } from './epic.js';
import { GogAdapter } from './gog.js';
import { HumbleAdapter } from './humble.js';
import { ItadAdapter } from './itad.js';
import { SteamAdapter } from './steam.js';

export interface AdapterConfig {
  sources: readonly string[];
  country: string;
  currency: string;
  minDiscount: number;
  itad: { apiKey: string; shops: readonly string[] };
  /** Só para testes: troca o endereço de cada loja. */
  baseUrls?: Partial<Record<'steam' | 'epic' | 'gog' | 'humble' | 'itad', string>>;
}

export function buildAdapters(cfg: AdapterConfig, warn: (msg: string) => void = () => undefined): PromotionAdapter[] {
  const adapters: PromotionAdapter[] = [];
  const base = cfg.baseUrls ?? {};
  for (const source of cfg.sources) {
    if (source === 'steam') adapters.push(new SteamAdapter({ country: cfg.country, baseUrl: base.steam }));
    else if (source === 'epic') adapters.push(new EpicAdapter({ country: cfg.country, baseUrl: base.epic }));
    else if (source === 'gog') adapters.push(new GogAdapter({ country: cfg.country, currency: cfg.currency, baseUrl: base.gog }));
    else if (source === 'humble') adapters.push(new HumbleAdapter({ baseUrl: base.humble }));
    else if (source === 'itad') {
      if (!cfg.itad.apiKey) {
        warn('ITAD_API_KEY vazio: Nuuvem e Green Man Gaming ficam de fora (crie a chave em isthereanydeal.com/apps).');
        continue;
      }
      adapters.push(
        new ItadAdapter({
          apiKey: cfg.itad.apiKey,
          country: cfg.country,
          shops: [...cfg.itad.shops],
          minDiscount: cfg.minDiscount,
          baseUrl: base.itad,
        }),
      );
    } else warn(`loja desconhecida em PROMO_SOURCES: ${source}`);
  }
  return adapters;
}
