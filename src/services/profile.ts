import { prisma } from '../db.js';
import { ACHIEVEMENTS } from '../lib/achievements.js';
import { computeRivalries, type DuelRecord } from '../lib/rivalry.js';
import { MatchStatus } from '../lib/types.js';
import { ensureStats } from './players.js';
import { getPosition } from './ranking.js';
import { getActiveSeason } from './seasons.js';
import { countTournamentTitles } from './achievements.js';

const WEEK = 7 * 86_400_000;

export async function getProfile(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { achievements: true, titles: true },
  });
  if (!player) return null;

  const season = await getActiveSeason();
  const stats = await ensureStats(prisma, playerId, season.id);
  const position = await getPosition(prisma, season.id, playerId);

  const confirmed = await prisma.matchParticipant.findMany({
    where: { playerId, match: { status: MatchStatus.CONFIRMED } },
    include: { match: true },
  });

  const winsThisWeek = confirmed.filter(
    (p) =>
      p.match.seasonId === season.id &&
      p.match.winnerSide === p.side &&
      p.match.confirmedAt &&
      Date.now() - p.match.confirmedAt.getTime() < WEEK,
  ).length;

  const gameCount = new Map<string, number>();
  for (const p of confirmed) gameCount.set(p.match.game, (gameCount.get(p.match.game) ?? 0) + 1);
  const favoriteGames = [...gameCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);

  const allWins = confirmed.filter((p) => p.match.winnerSide === p.side).length;
  const seasonTitles = await prisma.season.count({ where: { championId: playerId } });
  const tournamentTitles = await countTournamentTitles(prisma, playerId);

  const total = stats.wins + stats.losses;
  return {
    player,
    season,
    stats,
    position,
    winRate: total === 0 ? 0 : Math.round((stats.wins / total) * 100),
    winsThisWeek,
    favoriteGames,
    career: { matches: confirmed.length, wins: allWins, seasonTitles, tournamentTitles },
    achievements: ACHIEVEMENTS.filter((a) => player.achievements.some((x) => x.key === a.key)),
  };
}

/** Confrontos 1v1 confirmados do jogador, de todas as temporadas. */
export async function duelRecords(playerId: string): Promise<DuelRecord[]> {
  const matches = await prisma.match.findMany({
    where: {
      status: MatchStatus.CONFIRMED,
      team1Id: null,
      team2Id: null,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  });
  const records: DuelRecord[] = [];
  for (const m of matches) {
    if (m.participants.length !== 2) continue;
    const me = m.participants.find((p) => p.playerId === playerId)!;
    const opp = m.participants.find((p) => p.playerId !== playerId)!;
    records.push({ opponentId: opp.playerId, won: m.winnerSide === me.side, playedAt: m.confirmedAt ?? m.createdAt });
  }
  return records;
}

export async function getRivalries(playerId: string) {
  return computeRivalries(await duelRecords(playerId));
}
