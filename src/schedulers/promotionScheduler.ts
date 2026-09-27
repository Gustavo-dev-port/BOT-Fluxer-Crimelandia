/** Roda o módulo de promoções no intervalo configurado (padrão: a cada 30 min). */
import cron from 'node-cron';
import { FluxerPromotionPublisher } from '../bot/promotionPublisher.js';
import { config } from '../config.js';
import { PromotionRepository } from '../database/promotionRepository.js';
import type { FluxerClient } from '../fluxer/client.js';
import { buildAdapters } from '../services/promotions/adapters/index.js';
import { PromotionService } from '../services/promotions/promotionService.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('promoções');
let service: PromotionService | null = null;

export function getPromotionService(client: FluxerClient): PromotionService {
  service ??= new PromotionService(
    buildAdapters(config.promotions, (msg) => log.warn(msg)),
    new PromotionRepository(),
    new FluxerPromotionPublisher(client),
    config.promotions,
    log,
  );
  return service;
}

async function runOnce(client: FluxerClient) {
  try {
    await getPromotionService(client).sync();
  } catch (err) {
    log.error('rodada de promoções falhou', errorMeta(err));
  }
}

export function startPromotionScheduler(client: FluxerClient) {
  if (!config.promotions.enabled) {
    log.info('módulo de promoções desativado (PROMO_ENABLED=false)');
    return;
  }
  cron.schedule(config.promotions.cron, () => void runOnce(client), { timezone: config.timezone });
  // Primeira rodada logo após iniciar, para não esperar 30 minutos.
  setTimeout(() => void runOnce(client), 15_000);
  log.info(`agendado (${config.promotions.cron}), lojas: ${config.promotions.sources.join(', ')}`);
}
