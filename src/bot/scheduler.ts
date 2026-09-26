import type { Client } from 'discord.js';
import cron from 'node-cron';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { expireStaleChallenges } from '../services/matches.js';
import { endActiveSeason, isSeasonOver } from '../services/seasons.js';
import { announceSeasonEnd } from './announcer.js';
import { getGuild } from './channels.js';
import { closeDueWeeklyEvents, openWeeklyEvent } from './weeklyEvent.js';

function safe(name: string, fn: () => Promise<unknown>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[agendador] ${name} falhou:`, err);
    }
  };
}

async function removeExpiredRoles(client: Client) {
  const expired = await prisma.tempRole.findMany({ where: { expiresAt: { lte: new Date() } } });
  if (!expired.length) return;
  const guild = await getGuild(client);
  for (const t of expired) {
    const role = await guild.roles.fetch(t.roleId).catch(() => null);
    if (role) {
      if (t.deleteRole) await role.delete('Item da loja expirou').catch(() => undefined);
      else {
        const member = await guild.members.fetch(t.playerId).catch(() => null);
        await member?.roles.remove(role).catch(() => undefined);
      }
    }
    await prisma.tempRole.delete({ where: { id: t.id } });
  }
}

export function startScheduler(client: Client) {
  const opts = { timezone: config.timezone };

  // Manutenção a cada 5 minutos.
  cron.schedule(
    '*/5 * * * *',
    safe('manutenção', async () => {
      const expired = await expireStaleChallenges();
      if (expired.length) console.log(`[agendador] ${expired.length} desafio(s) expirado(s)`);
      await removeExpiredRoles(client);
      await closeDueWeeklyEvents(client);
      if (await isSeasonOver()) await announceSeasonEnd(client, await endActiveSeason());
    }),
    opts,
  );

  if (config.weeklyEvent.enabled) {
    cron.schedule(config.weeklyEvent.openCron, safe('evento semanal', () => openWeeklyEvent(client)), opts);
  }
  console.log(`[agendador] ativo (fuso ${config.timezone})`);
}
