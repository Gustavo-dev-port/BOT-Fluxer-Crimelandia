import cron from 'node-cron';
import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import { prisma } from '../database/client.js';
import { expireStaleChallenges } from '../services/matches.js';
import { endActiveSeason, isSeasonOver } from '../services/seasons.js';
import { announceSeasonEnd } from '../services/notifications/announcer.js';
import { updateHallOfFame } from '../services/notifications/hallAnnouncer.js';
import { announceDailyMissions } from '../services/notifications/missionTracker.js';
import { voicePresence } from '../services/voicePresence.js';
import { cleanupEmptyRooms } from '../services/notifications/voiceRooms.js';
import { cleanupEndedNights, closeDueWeeklyEvents, openWeeklyEvent } from './weeklyEvent.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('agendador');

function safe(name: string, fn: () => Promise<unknown>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      log.error(`${name} falhou`, errorMeta(err));
    }
  };
}

async function removeExpiredRoles(client: FluxerClient) {
  const expired = await prisma.tempRole.findMany({ where: { expiresAt: { lte: new Date() } } });
  for (const t of expired) {
    const reason = 'Item da loja expirou';
    if (t.deleteRole) await client.rest.deleteRole(client.guildId, t.roleId, reason).catch(() => undefined);
    else await client.rest.removeMemberRole(client.guildId, t.playerId, t.roleId, reason).catch(() => undefined);
    await prisma.tempRole.delete({ where: { id: t.id } });
  }
}

/** Devolve o apelido original de quem tinha um apelido especial vencido. */
export async function restoreExpiredNicknames(client: FluxerClient, now = new Date()) {
  const expired = await prisma.tempNickname.findMany({ where: { expiresAt: { lte: now } } });
  for (const t of expired) {
    await client.rest
      .modifyMember(client.guildId, t.playerId, { nick: t.previousNick }, 'Apelido especial expirou')
      .catch((err: unknown) => log.warn('falha ao devolver apelido', { user: t.playerId, ...errorMeta(err) }));
    await prisma.tempNickname.delete({ where: { playerId: t.playerId } });
  }
}

export function startScheduler(client: FluxerClient) {
  const opts = { timezone: config.timezone };

  // Manutenção a cada 5 minutos.
  cron.schedule(
    '*/5 * * * *',
    safe('manutenção', async () => {
      const expired = await expireStaleChallenges();
      if (expired.length) log.info(`${expired.length} desafio(s) expirado(s)`);
      await removeExpiredRoles(client);
      await restoreExpiredNicknames(client);
      await closeDueWeeklyEvents(client);
      await cleanupEndedNights(client);
      if (await isSeasonOver()) await announceSeasonEnd(client, await endActiveSeason());
    }),
    opts,
  );

  // Missões diárias: 3 novas à meia-noite (fuso TIMEZONE).
  cron.schedule(
    '0 0 * * *',
    safe('missões diárias', () => announceDailyMissions(client)),
    opts,
  );

  // A cada minuto: minutos em voz (progresso em tempo real) e salas temporárias vazias.
  cron.schedule(
    '* * * * *',
    safe('voz', async () => {
      voicePresence.flush();
      await cleanupEmptyRooms(client);
    }),
    opts,
  );

  // Hall do Reino a cada 10 minutos.
  cron.schedule(
    '*/10 * * * *',
    safe('hall do reino', () => updateHallOfFame(client)),
    opts,
  );

  if (config.weeklyEvent.enabled) {
    cron.schedule(
      config.weeklyEvent.openCron,
      safe('evento semanal', () => openWeeklyEvent(client)),
      opts,
    );
  }
  log.info(`ativo (fuso ${config.timezone})`);
}
