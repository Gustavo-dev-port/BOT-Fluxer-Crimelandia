/**
 * Worker do Fluxer: o processo que fica ligado 24/7, sem depender de nenhuma página aberta.
 * Conecta ao Gateway (com reconexão automática), trata os eventos (comandos, reações, voz,
 * novos membros) e roda as tarefas agendadas (manutenção, missões, Night Fluxer, promoções,
 * jogos grátis, progressão de cargos). Expõe GET /health e se encerra de forma limpa.
 */
import type { Server } from 'node:http';
import cron from 'node-cron';
import { config } from '../config.js';
import { prisma } from '../database/client.js';
import { FluxerClient } from '../fluxer/client.js';
import { BOT_PERMISSIONS } from '../fluxer/permissions.js';
import type { GuildMemberAddEvent, MessageCreateEvent, ReactionEvent } from '../fluxer/types.js';
import { onMessageCreate } from '../events/messageCreate.js';
import { onReaction } from '../events/reactions.js';
import { onVoiceEvent } from '../events/voiceState.js';
import { updateScoreboard } from '../services/notifications/announcer.js';
import { updateHallOfFame } from '../services/notifications/hallAnnouncer.js';
import { trackVoice } from '../services/notifications/missionTracker.js';
import { trackRooms } from '../services/notifications/voiceRooms.js';
import { onMemberAdd } from '../services/notifications/onboarding.js';
import { seedDefaultGames } from '../services/games.js';
import { getActiveSeason } from '../services/seasons.js';
import { ensureDailyMissions } from '../services/missions.js';
import { musicService } from '../services/music/musicService.js';
import { startScheduler } from '../schedulers/maintenanceScheduler.js';
import { startFreeGameScheduler } from '../schedulers/freeGameScheduler.js';
import { startPromotionScheduler } from '../schedulers/promotionScheduler.js';
import type { Stoppable } from '../schedulers/types.js';
import { errorMeta, scoped } from '../utils/logger.js';
import { drainQueues } from '../utils/queue.js';
import { retry } from '../utils/retry.js';
import { checkHealth, type HealthReport, startHealthServer } from './health.js';
import { WorkerStatus } from './status.js';

const log = scoped('worker');
const gatewayLog = scoped('gateway');

export interface WorkerOptions {
  instanceUrl: string;
  token: string;
  guildId: string;
  /** Porta do GET /health (null = sem servidor HTTP; 0 = porta livre qualquer, para testes). */
  healthPort: number | null;
  healthHost?: string;
  /** Minutos sem Gateway/banco até chamar onFatal (0 = nunca). */
  watchdogMinutes: number;
  gatewayGraceMs: number;
  /** Liga os agendadores (os testes desligam). */
  schedulers?: boolean;
  /** Erro sem volta (token inválido, watchdog): o processo deve sair para ser reiniciado. */
  onFatal: (reason: string) => void;
  /** Tentativas da inicialização (descoberta do Fluxer, banco). */
  startupAttempts?: number;
}

export interface Worker {
  client: FluxerClient;
  status: WorkerStatus;
  health(): Promise<HealthReport>;
  /** Porta real do /health (null = sem servidor). */
  healthPort: number | null;
  stop(): Promise<void>;
}

const pingDatabase = () => prisma.$queryRawUnsafe('SELECT 1');

export async function startWorker(opts: WorkerOptions): Promise<Worker> {
  const status = new WorkerStatus();
  const health = () => checkHealth(status, { pingDatabase, gatewayGraceMs: opts.gatewayGraceMs });
  // O /health sobe primeiro: durante a inicialização ele responde "starting" (503).
  let server: Server | null = null;
  let healthPort: number | null = null;
  if (opts.healthPort !== null) {
    // Porta ocupada (ex.: outro programa na 3000) não impede o bot de funcionar.
    server = await startHealthServer(opts.healthPort, opts.healthHost ?? '0.0.0.0', health).catch((err: unknown) => {
      log.warn(`health check desligado: porta ${opts.healthPort} indisponível (mude HEALTH_PORT)`, errorMeta(err));
      return null;
    });
    const address = server?.address();
    if (server) healthPort = address && typeof address === 'object' ? address.port : opts.healthPort;
    if (healthPort !== null) log.info(`health check em http://${opts.healthHost ?? '0.0.0.0'}:${healthPort}/health`);
  }

  const attempts = opts.startupAttempts ?? 8;
  const onRetry = (what: string) => (err: unknown, attempt: number, delay: number) =>
    log.warn(`${what} falhou (tentativa ${attempt}/${attempts - 1}); de novo em ${Math.round(delay / 1000)} s`, errorMeta(err));
  await retry(() => pingDatabase(), { attempts, onRetry: onRetry('conexão com o banco') });
  const client = await retry(() => FluxerClient.create(opts.instanceUrl, opts.token, opts.guildId), {
    attempts,
    onRetry: onRetry('descoberta da instância do Fluxer'),
  });

  const tasks: Stoppable[] = [];
  let started = false;
  let stopping: Promise<void> | null = null;

  // Missões de voz e salas temporárias: liga antes do GUILD_CREATE com quem já está em voz.
  trackVoice(client);
  trackRooms(client);

  client.gateway.on('ready', (user) => {
    status.gatewayUp();
    log.info(`conectado ao Fluxer como ${user.username} (${user.id})`);
    // Um novo Identify (após perder a sessão) dispara READY de novo; o resto só roda uma vez.
    if (started || stopping) return;
    started = true;
    void boot().catch((err: unknown) => {
      log.error('falha ao iniciar os módulos', errorMeta(err));
      opts.onFatal('falha ao iniciar os módulos');
    });
  });

  async function boot() {
    log.info(`link de convite: ${client.inviteUrl(opts.token, BOT_PERMISSIONS)}`);
    await seedDefaultGames();
    await ensureDailyMissions();
    if (config.music.enabled) {
      const restored = await musicService(client).restoreQueue();
      if (restored) log.info(`${restored} música(s) da fila salva; use !continuar para tocar`);
    }
    const season = await getActiveSeason();
    log.info(`Temporada ${season.number} ativa até ${season.endsAt.toISOString()}`);
    await updateScoreboard(client).catch((err: unknown) => log.error('falha ao atualizar o placar', errorMeta(err)));
    await updateHallOfFame(client).catch((err: unknown) => log.error('falha ao atualizar o Hall do Reino', errorMeta(err)));
    if (opts.schedulers !== false && !stopping) {
      tasks.push(...startScheduler(client), ...startPromotionScheduler(client), ...startFreeGameScheduler(client));
    }
    status.state = 'running';
    log.info('worker rodando');
  }

  client.gateway.on('dispatch', (event, data) => {
    if (event === 'RESUMED') status.gatewayUp();
    if (stopping) return; // desligando: não começa trabalho novo
    const run = (p: Promise<unknown>) => p.catch((err: unknown) => log.error(`erro ao tratar ${event}`, errorMeta(err)));
    if (event === 'MESSAGE_CREATE') run(onMessageCreate(client, data as MessageCreateEvent));
    else if (event === 'MESSAGE_REACTION_ADD') run(onReaction(client, data as ReactionEvent, true));
    else if (event === 'MESSAGE_REACTION_REMOVE') run(onReaction(client, data as ReactionEvent, false));
    else if (event === 'GUILD_MEMBER_ADD') run(onMemberAdd(client, data as GuildMemberAddEvent));
    else onVoiceEvent(client, event, data);
  });

  client.gateway.on('close', (code, reason) => {
    status.gatewayDown();
    if (!stopping) gatewayLog.warn(`conexão fechada (${code}) ${reason}; reconectando`);
  });
  client.gateway.on('error', (err) => {
    gatewayLog.error(err.message);
    // Erros sem volta (token inválido etc.): o processo sai e o Docker/PM2 reinicia.
    if (/Gateway fechou/.test(err.message)) opts.onFatal(err.message);
  });

  // Watchdog: Gateway ou banco fora por tempo demais → reinício limpo do processo.
  const watchdogMs = opts.watchdogMinutes * 60_000;
  const watchdog =
    watchdogMs > 0
      ? setInterval(() => {
          void health().then(() => {
            if (stopping) return;
            if (status.gatewayDownFor() > watchdogMs) opts.onFatal(`Gateway desconectado há mais de ${opts.watchdogMinutes} min`);
            else if (status.databaseDownFor() > watchdogMs) opts.onFatal(`banco indisponível há mais de ${opts.watchdogMinutes} min`);
          });
        }, 30_000)
      : null;
  watchdog?.unref();

  async function stop() {
    stopping ??= (async () => {
      status.state = 'stopping';
      log.info('desligando: parando agendadores e terminando o que está em andamento...');
      if (watchdog) clearInterval(watchdog);
      for (const t of tasks) await Promise.resolve(t.stop()).catch(() => undefined);
      // Tarefas do cron criadas fora da lista (por segurança).
      for (const t of cron.getTasks().values()) await Promise.resolve(t.destroy()).catch(() => undefined);
      if (!(await drainQueues(10_000))) log.warn('filas não terminaram em 10 s; seguindo com o desligamento');
      if (config.music.enabled)
        await musicService(client)
          .voice.leave()
          .catch(() => undefined);
      client.destroy();
      if (server) await new Promise((r) => server!.close(r));
      log.info('worker parado');
    })();
    return stopping;
  }

  client.login();
  return { client, status, health, healthPort, stop };
}
