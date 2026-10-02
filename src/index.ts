/**
 * Ponto de entrada: sobe o worker do Fluxer e cuida do processo
 * (sinais de desligamento, erros globais e saída para o Docker/PM2 reiniciar).
 */
import { config } from './config.js';
import { prisma } from './database/client.js';
import { errorMeta, scoped } from './utils/logger.js';
import { startWorker, type Worker } from './worker/worker.js';

const log = scoped('worker');

let worker: Worker | null = null;
let exiting = false;

async function shutdown(code: number, reason: string) {
  if (exiting) return;
  exiting = true;
  log.info(`encerrando (${reason})`);
  // Se algo travar, sai mesmo assim (o Docker manda SIGKILL depois de stop_grace_period).
  setTimeout(() => process.exit(code), 25_000).unref();
  try {
    await worker?.stop();
    await prisma.$disconnect();
  } catch (err) {
    log.error('erro ao desligar', errorMeta(err));
  }
  process.exit(code);
}

// Tratamento global: registra o erro em vez de derrubar o bot sem rastro.
process.on('unhandledRejection', (reason) => log.error('promise rejeitada sem tratamento', errorMeta(reason)));
process.on('uncaughtException', (err) => {
  log.error('exceção não tratada; encerrando para reiniciar limpo', errorMeta(err));
  void shutdown(1, 'exceção não tratada');
});
process.on('SIGINT', () => void shutdown(0, 'SIGINT'));
process.on('SIGTERM', () => void shutdown(0, 'SIGTERM'));

try {
  worker = await startWorker({
    instanceUrl: config.instanceUrl,
    token: config.token(),
    guildId: config.guildId(),
    healthPort: config.worker.healthPort > 0 ? config.worker.healthPort : null,
    healthHost: config.worker.healthHost,
    watchdogMinutes: config.worker.watchdogMinutes,
    gatewayGraceMs: config.worker.gatewayGraceSeconds * 1000,
    onFatal: (reason) => void shutdown(1, reason),
  });
} catch (err) {
  log.error('não foi possível iniciar o worker', errorMeta(err));
  await shutdown(1, 'falha na inicialização');
}
