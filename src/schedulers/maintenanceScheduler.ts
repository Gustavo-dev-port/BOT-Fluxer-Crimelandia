import cron from 'node-cron';
import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import { prisma } from '../database/client.js';
import { expireStaleChallenges } from '../services/matches.js';
import { endActiveSeason, isSeasonOver } from '../services/seasons.js';
import { announceSeasonEnd } from '../services/notifications/announcer.js';
import { closeDueWeeklyEvents, openWeeklyEvent } from './weeklyEvent.js';
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
      if (await isSeasonOver()) await announceSeasonEnd(client, await endActiveSeason());
    }),
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
