import { config } from '../config.js';
import { type Db, prisma, transaction } from '../database/client.js';
import { startOfNextMonth } from '../utils/calendar.js';
import { softReset } from './rules/elo.js';
import type { Achievement } from './rules/achievements.js';
import { checkAchievements } from './achievements.js';
import { addCoins } from './economy.js';
import { getRanking, type RankingRow } from './ranking.js';

const DAY = 86_400_000;

/** Fim da próxima temporada: virada do mês (padrão) ou SEASON_DAYS dias. */
export function nextSeasonEnd(now: Date): Date {
  if (config.season.mode === 'days') return new Date(now.getTime() + config.season.durationDays * DAY);
  return startOfNextMonth(now, config.timezone);
}

/** Temporada ativa; cria a Temporada 1 no primeiro uso. */
export async function getActiveSeason(db: Db = prisma) {
  const active = await db.season.findFirst({ where: { active: true }, orderBy: { number: 'desc' } });
  if (active) return active;
  const last = await db.season.findFirst({ orderBy: { number: 'desc' } });
  return db.season.create({
    data: {
      number: (last?.number ?? 0) + 1,
      endsAt: nextSeasonEnd(new Date()),
    },
  });
}

export interface SeasonEndResult {
  endedNumber: number;
  championId: string | null;
  previousChampionId: string | null;
  finalTop: RankingRow[];
  newSeasonNumber: number;
  newSeasonEndsAt: Date;
  unlocked: Achievement[];
}

/**
 * Encerra a temporada ativa: define o campeão, paga o prêmio, arquiva as
 * estatísticas (elas ficam ligadas à temporada antiga) e abre a próxima
 * com o rating resetado total ou parcialmente.
 */
export async function endActiveSeason(): Promise<SeasonEndResult> {
  return transaction(async (tx) => {
    const season = await getActiveSeason(tx);
    const previous = await tx.season.findFirst({
      where: { number: { lt: season.number }, championId: { not: null } },
      orderBy: { number: 'desc' },
    });
    const finalTop = await getRanking(tx, season.id, { limit: 10 });
    const championId = finalTop[0]?.playerId ?? null;

    await tx.season.update({
      where: { id: season.id },
      data: { active: false, endedAt: new Date(), championId },
    });

    let unlocked: Achievement[] = [];
    if (championId) {
      await addCoins(tx, championId, config.coins.champion, `Campeão da Temporada ${season.number}`);
    }

    const next = await tx.season.create({
      data: {
        number: season.number + 1,
        endsAt: nextSeasonEnd(new Date()),
      },
    });

    // Reset parcial: quem jogou na temporada anterior começa perto do rating antigo.
    if (config.season.carryOver > 0) {
      const oldStats = await tx.playerSeasonStats.findMany({ where: { seasonId: season.id } });
      for (const s of oldStats) {
        await tx.playerSeasonStats.create({
          data: {
            playerId: s.playerId,
            seasonId: next.id,
            rating: softReset(s.rating, config.elo.initial, config.season.carryOver),
          },
        });
      }
    }

    if (championId) unlocked = await checkAchievements(tx, championId);

    return {
      endedNumber: season.number,
      championId,
      previousChampionId: previous?.championId ?? null,
      finalTop,
      newSeasonNumber: next.number,
      newSeasonEndsAt: next.endsAt,
      unlocked,
    };
  });
}

export async function isSeasonOver(): Promise<boolean> {
  const season = await getActiveSeason();
  return season.endsAt.getTime() <= Date.now();
}
