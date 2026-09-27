/**
 * Hall do Reino: os destaques da comunidade, recalculados a cada 10 minutos.
 */
import { type Db, prisma } from '../database/client.js';
import { MatchStatus } from '../types/domain.js';
import { getRanking } from './ranking.js';
import { getActiveSeason } from './seasons.js';

const DAY = 86_400_000;
/** Janela do MVP da semana. */
export const MVP_WINDOW_DAYS = 7;
/** Janela do jogador mais ativo. */
export const ACTIVE_WINDOW_DAYS = 30;

export interface HallEntry {
  playerId: string;
  value: number;
}

export interface HallOfFame {
  /** Campeão da última temporada encerrada; sem nenhuma, o líder da temporada atual. */
  champion: (HallEntry & { seasonNumber: number; current: boolean }) | null;
  mvpWeek: HallEntry | null;
  mostActive: HallEntry | null;
  bestStreak: HallEntry | null;
  mostWins: HallEntry | null;
  richest: HallEntry | null;
  updatedAt: Date;
}

/** Maior valor; empate → quem chegou nele primeiro na lista (ordem estável). */
export function leader(values: Map<string, number>): HallEntry | null {
  let best: HallEntry | null = null;
  for (const [playerId, value] of values) if (value > 0 && (!best || value > best.value)) best = { playerId, value };
  return best;
}

export async function getHallOfFame(db: Db = prisma, now = new Date()): Promise<HallOfFame> {
  const season = await getActiveSeason();

  let champion: HallOfFame['champion'] = null;
  const lastChampion = await db.season.findFirst({
    where: { active: false, championId: { not: null } },
    orderBy: { number: 'desc' },
  });
  if (lastChampion?.championId) {
    const stats = await db.playerSeasonStats.findUnique({
      where: { playerId_seasonId: { playerId: lastChampion.championId, seasonId: lastChampion.id } },
    });
    champion = { playerId: lastChampion.championId, value: stats?.points ?? 0, seasonNumber: lastChampion.number, current: false };
  } else {
    const [top] = await getRanking(db, season.id, { limit: 1 });
    if (top) champion = { playerId: top.playerId, value: top.points, seasonNumber: season.number, current: true };
  }

  // Partidas confirmadas recentes: MVP (vitórias em 7 dias) e mais ativo (partidas em 30 dias).
  const recent = await db.matchParticipant.findMany({
    where: { match: { status: MatchStatus.CONFIRMED, confirmedAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY) } } },
    include: { match: { select: { winnerSide: true, confirmedAt: true } } },
    orderBy: { match: { confirmedAt: 'asc' } },
  });
  const weekStart = now.getTime() - MVP_WINDOW_DAYS * DAY;
  const weekWins = new Map<string, number>();
  const activity = new Map<string, number>();
  for (const p of recent) {
    activity.set(p.playerId, (activity.get(p.playerId) ?? 0) + 1);
    if (p.match.winnerSide === p.side && p.match.confirmedAt && p.match.confirmedAt.getTime() >= weekStart) {
      weekWins.set(p.playerId, (weekWins.get(p.playerId) ?? 0) + 1);
    }
  }

  const streak = await db.playerSeasonStats.findFirst({ where: { bestStreak: { gt: 0 } }, orderBy: { bestStreak: 'desc' } });

  const winsBySeason = await db.playerSeasonStats.groupBy({ by: ['playerId'], _sum: { wins: true } });
  const wins = new Map(
    winsBySeason.sort((a, b) => a.playerId.localeCompare(b.playerId)).map((r) => [r.playerId, r._sum.wins ?? 0] as const),
  );

  const rich = await db.player.findFirst({ where: { coins: { gt: 0 } }, orderBy: { coins: 'desc' } });

  return {
    champion,
    mvpWeek: leader(weekWins),
    mostActive: leader(activity),
    bestStreak: streak ? { playerId: streak.playerId, value: streak.bestStreak } : null,
    mostWins: leader(wins),
    richest: rich ? { playerId: rich.id, value: rich.coins } : null,
    updatedAt: now,
  };
}
