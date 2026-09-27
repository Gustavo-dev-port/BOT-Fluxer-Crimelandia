/** Roda o módulo de jogos grátis no intervalo configurado (padrão: a cada 1 hora). */
import cron from 'node-cron';
import { FluxerFreeGamePublisher } from '../services/notifications/freeGamePublisher.js';
import { config } from '../config.js';
import { FreeGameRepository } from '../database/freeGameRepository.js';
import type { FluxerClient } from '../fluxer/client.js';
import { FreeGameService } from '../services/freeGames/freeGameService.js';
import { buildFreeGameSources } from '../services/freeGames/sources/index.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('jogos grátis');
let service: FreeGameService | null = null;

export function getFreeGameService(client: FluxerClient): FreeGameService {
  service ??= new FreeGameService(
    buildFreeGameSources(config.freeGames, (msg) => log.warn(msg)),
    new FreeGameRepository(),
    new FluxerFreeGamePublisher(client),
    config.freeGames,
    log,
  );
  return service;
}

async function runOnce(client: FluxerClient) {
  try {
    await getFreeGameService(client).sync();
  } catch (err) {
    log.error('rodada de jogos grátis falhou', errorMeta(err));
  }
}

export function startFreeGameScheduler(client: FluxerClient) {
  if (!config.freeGames.enabled) {
    log.info('módulo de jogos grátis desativado (FREE_GAMES_ENABLED=false)');
    return;
  }
  cron.schedule(config.freeGames.cron, () => void runOnce(client), { timezone: config.timezone });
  setTimeout(() => void runOnce(client), 20_000);
  log.info(`agendado (${config.freeGames.cron}), fontes: ${config.freeGames.sources.join(', ')}`);
}
