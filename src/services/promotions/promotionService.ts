/**
 * Regras do módulo de promoções (sem saber de Fluxer nem de HTTP):
 * - junta as ofertas de todos os adaptadores (uma loja com erro não derruba as outras);
 * - ignora descontos abaixo do mínimo e duplicatas;
 * - publica só o que é novo, no máximo `maxPostsPerRun` por rodada (o resto sai nas próximas);
 * - quando o preço muda, atualiza o banco e a mensagem já publicada;
 * - encerra promoções vencidas.
 */
import type { PromotionRepository, StoredPromotion } from '../../database/promotionRepository.js';
import type { PromotionAdapter, PromotionOffer } from './types.js';

export interface PromotionPublisher {
  /** Publica e devolve onde ficou a mensagem; null se o canal não está configurado ou o envio falhou. */
  publishNew(offer: PromotionOffer): Promise<{ channelId: string; messageId: string } | null>;
  publishUpdate(stored: StoredPromotion, offer: PromotionOffer): Promise<void>;
}

export interface PromotionSettings {
  minDiscount: number;
  maxPostsPerRun: number;
  /** Dias sem aparecer nas lojas até a promoção ser considerada encerrada. */
  staleDays: number;
}

export interface SyncReport {
  fetched: number;
  eligible: number;
  posted: number;
  updated: number;
  deferred: number;
  ended: number;
  failedSources: { source: string; error: string }[];
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/** Mudou algo que o jogador vê (preço, desconto ou prazo)? */
export function priceChanged(stored: StoredPromotion, offer: PromotionOffer): boolean {
  return (
    stored.currentPrice !== offer.currentPrice ||
    stored.oldPrice !== offer.oldPrice ||
    stored.discount !== offer.discount ||
    (stored.expiresAt?.getTime() ?? null) !== (offer.expiresAt?.getTime() ?? null)
  );
}

/** Filtra pelo desconto mínimo e remove duplicatas, ficando com o maior desconto. */
export function selectEligible(offers: PromotionOffer[], minDiscount: number): PromotionOffer[] {
  const best = new Map<string, PromotionOffer>();
  for (const o of offers) {
    if (o.discount < minDiscount || o.discount > 100 || o.currentPrice >= o.oldPrice) continue;
    const prev = best.get(o.id);
    if (!prev || o.discount > prev.discount) best.set(o.id, o);
  }
  return [...best.values()].sort((a, b) => b.discount - a.discount || a.currentPrice - b.currentPrice);
}

export class PromotionService {
  private running = false;

  constructor(
    private readonly adapters: PromotionAdapter[],
    private readonly repo: PromotionRepository,
    private readonly publisher: PromotionPublisher,
    private readonly settings: PromotionSettings,
    private readonly log: Logger,
  ) {}

  async collect(): Promise<{ offers: PromotionOffer[]; failedSources: SyncReport['failedSources'] }> {
    const results = await Promise.allSettled(this.adapters.map((a) => a.fetchOffers()));
    const offers: PromotionOffer[] = [];
    const failedSources: SyncReport['failedSources'] = [];
    results.forEach((r, i) => {
      const source = this.adapters[i].name;
      if (r.status === 'fulfilled') {
        offers.push(...r.value);
        this.log.info(`${source}: ${r.value.length} ofertas`);
      } else {
        const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
        failedSources.push({ source, error });
        this.log.warn(`${source} falhou`, { error });
      }
    });
    return { offers, failedSources };
  }

  /** Uma rodada completa. Rodadas simultâneas são ignoradas. */
  async sync(now = new Date()): Promise<SyncReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const { offers, failedSources } = await this.collect();
      const eligible = selectEligible(offers, this.settings.minDiscount);
      const report: SyncReport = {
        fetched: offers.length,
        eligible: eligible.length,
        posted: 0,
        updated: 0,
        deferred: 0,
        ended: 0,
        failedSources,
      };

      // Sem canal configurado, as novas ficam para depois (não são marcadas como vistas).
      let noChannel = false;
      for (const offer of eligible) {
        if (offer.expiresAt && offer.expiresAt <= now) continue;
        const stored = await this.repo.find(offer.id);
        if (!stored) {
          if (noChannel || report.posted >= this.settings.maxPostsPerRun) {
            report.deferred++;
            continue;
          }
          const message = await this.publisher.publishNew(offer);
          if (!message) {
            noChannel = true;
            report.deferred++;
            continue;
          }
          await this.repo.create(offer, message, now);
          report.posted++;
        } else if (priceChanged(stored, offer)) {
          const updated = await this.repo.update(offer, now);
          if (stored.messageId) await this.publisher.publishUpdate(updated, offer);
          report.updated++;
        } else {
          await this.repo.touch(offer.id, now);
        }
      }

      report.ended = await this.repo.deactivateEnded(now, this.settings.staleDays);
      this.log.info('rodada de promoções concluída', { ...report, failedSources: failedSources.length });
      return report;
    } finally {
      this.running = false;
    }
  }
}
