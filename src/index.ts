import { updateScoreboard } from './services/notifications/announcer.js';
import { onMessageCreate } from './events/messageCreate.js';
import { updateHallOfFame } from './services/notifications/hallAnnouncer.js';
import { onReaction } from './events/reactions.js';
import { onVoiceEvent } from './events/voiceState.js';
import { trackVoice } from './services/notifications/missionTracker.js';
import { trackRooms } from './services/notifications/voiceRooms.js';
import { startScheduler } from './schedulers/maintenanceScheduler.js';
import { startFreeGameScheduler } from './schedulers/freeGameScheduler.js';
import { startPromotionScheduler } from './schedulers/promotionScheduler.js';
import { config } from './config.js';
import { prisma } from './database/client.js';
import { FluxerClient } from './fluxer/client.js';
import { BOT_PERMISSIONS } from './fluxer/permissions.js';
import type { MessageCreateEvent, ReactionEvent } from './fluxer/types.js';
import { seedDefaultGames } from './services/games.js';
import { getActiveSeason } from './services/seasons.js';
import { ensureDailyMissions } from './services/missions.js';
import { musicService } from './services/music/musicService.js';
import { errorMeta, scoped } from './utils/logger.js';

const log = scoped('bot');
const gatewayLog = scoped('gateway');

const client = await FluxerClient.create(config.instanceUrl, config.token(), config.guildId());
let started = false;
// Missões de voz: liga o rastreador antes de chegar o GUILD_CREATE com quem já está em voz.
trackVoice(client);
trackRooms(client);

client.gateway.on('ready', async (user) => {
  log.info(`conectado ao Fluxer como ${user.username} (${user.id})`);
  // Um novo Identify (após perder a sessão) dispara READY de novo; o resto só roda uma vez.
  if (started) return;
  started = true;
  log.info(`link de convite: ${client.inviteUrl(config.token(), BOT_PERMISSIONS)}`);
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
  startScheduler(client);
  startPromotionScheduler(client);
  startFreeGameScheduler(client);
});

client.gateway.on('dispatch', (event, data) => {
  const run = (p: Promise<unknown>) => p.catch((err: unknown) => log.error(`erro ao tratar ${event}`, errorMeta(err)));
  if (event === 'MESSAGE_CREATE') run(onMessageCreate(client, data as MessageCreateEvent));
  else if (event === 'MESSAGE_REACTION_ADD') run(onReaction(client, data as ReactionEvent, true));
  else if (event === 'MESSAGE_REACTION_REMOVE') run(onReaction(client, data as ReactionEvent, false));
  else onVoiceEvent(client, event, data);
});

client.gateway.on('close', (code, reason) => gatewayLog.warn(`conexão fechada (${code}) ${reason}`));
client.gateway.on('error', (err) => {
  gatewayLog.error(err.message);
  // Erros fatais (token inválido etc.) param o bot.
  if (/Gateway fechou/.test(err.message)) void shutdown(1);
});

async function shutdown(code = 0) {
  log.info('desligando...');
  await musicService(client)
    .voice.leave()
    .catch(() => undefined);
  client.destroy();
  await prisma.$disconnect();
  process.exit(code);
}
// Tratamento global: registra o erro em vez de derrubar o bot sem rastro.
process.on('unhandledRejection', (reason) => log.error('promise rejeitada sem tratamento', errorMeta(reason)));
process.on('uncaughtException', (err) => {
  log.error('exceção não tratada; encerrando', errorMeta(err));
  void shutdown(1);
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

client.login();
