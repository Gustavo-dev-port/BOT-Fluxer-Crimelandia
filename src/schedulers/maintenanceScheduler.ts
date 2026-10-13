import cron from 'node-cron';
import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import { FluxerApiError } from '../fluxer/rest.js';
import { prisma } from '../database/client.js';
import { expireStaleChallenges } from '../services/matches.js';
import { endActiveSeason, isSeasonOver } from '../services/seasons.js';
import { announceSeasonEnd } from '../services/notifications/announcer.js';
import { updateHallOfFame } from '../services/notifications/hallAnnouncer.js';
import { announceDailyMissions } from '../services/notifications/missionTracker.js';
import { voicePresence } from '../services/voicePresence.js';
import { cleanupEmptyRooms } from '../services/notifications/voiceRooms.js';
import { musicService } from '../services/music/musicService.js';
import { cleanupEndedNights, closeDueWeeklyEvents, openWeeklyEvent } from './weeklyEvent.js';
import { runPromotions } from '../services/notifications/onboarding.js';
import type { Stoppable } from './types.js';
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

/**
 * Executa a ação no Fluxer; true se deu certo ou se o alvo já não existe (404: cargo
 * apagado, membro saiu). Outras falhas devolvem false para tentar de novo na próxima rodada.
 */
async function appliedOrGone(action: () => Promise<unknown>, what: string, meta: Record<string, unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    if (err instanceof FluxerApiError && err.status === 404) return true;
    log.warn(`${what}; tento de novo em 5 min`, { ...meta, ...errorMeta(err) });
    return false;
  }
}

/** Tira os cargos/cores da loja que venceram. O registro só sai quando o Fluxer confirmou. */
export async function removeExpiredRoles(client: FluxerClient, now = new Date()) {
  const expired = await prisma.tempRole.findMany({ where: { expiresAt: { lte: now } } });
  for (const t of expired) {
    const reason = 'Item da loja expirou';
    const done = await appliedOrGone(
      () =>
        t.deleteRole
          ? client.rest.deleteRole(client.guildId, t.roleId, reason)
          : client.rest.removeMemberRole(client.guildId, t.playerId, t.roleId, reason),
      'falha ao remover item vencido',
      { user: t.playerId, role: t.roleId },
    );
    if (done) await prisma.tempRole.delete({ where: { id: t.id } });
  }
}

/** Devolve o apelido original de quem tinha um apelido especial vencido. */
export async function restoreExpiredNicknames(client: FluxerClient, now = new Date()) {
  const expired = await prisma.tempNickname.findMany({ where: { expiresAt: { lte: now } } });
  for (const t of expired) {
    const done = await appliedOrGone(
      () => client.rest.modifyMember(client.guildId, t.playerId, { nick: t.previousNick }, 'Apelido especial expirou'),
      'falha ao devolver apelido',
      { user: t.playerId },
    );
    if (done) await prisma.tempNickname.delete({ where: { playerId: t.playerId } });
  }
}

export function startScheduler(client: FluxerClient): Stoppable[] {
  const opts = { timezone: config.timezone };
  const tasks: Stoppable[] = [];

  // Manutenção a cada 5 minutos.
  tasks.push(
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
    ),
  );

  // Missões diárias: 3 novas à meia-noite (fuso TIMEZONE).
  tasks.push(
    cron.schedule(
      '0 0 * * *',
      safe('missões diárias', () => announceDailyMissions(client)),
      opts,
    ),
  );

  // A cada minuto: minutos em voz (progresso em tempo real) e salas temporárias vazias.
  tasks.push(
    cron.schedule(
      '* * * * *',
      safe('voz', async () => {
        voicePresence.flush();
        await cleanupEmptyRooms(client);
        await musicService(client).tick();
      }),
      opts,
    ),
  );

  // Hall do Reino a cada 10 minutos.
  tasks.push(
    cron.schedule(
      '*/10 * * * *',
      safe('hall do reino', () => updateHallOfFame(client)),
      opts,
    ),
  );

  if (config.weeklyEvent.enabled) {
    tasks.push(
      cron.schedule(
        config.weeklyEvent.openCron,
        safe('evento semanal', () => openWeeklyEvent(client)),
        opts,
      ),
    );
  }
  // Promoção automática Escudeiro → Mercenário (só faz algo se estiver ativada no !progressao).
  tasks.push(
    cron.schedule(
      '*/15 * * * *',
      safe('progressão', async () => {
        const run = await runPromotions(client);
        if (run.promoted.length) log.info(`${run.promoted.length} membro(s) promovido(s)`);
      }),
      opts,
    ),
  );
  log.info(`ativo (fuso ${config.timezone})`);
  return tasks;
}
