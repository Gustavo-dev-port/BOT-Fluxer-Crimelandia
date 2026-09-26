import type { Db } from '../db.js';
import { type Achievement, newlyUnlocked } from '../lib/achievements.js';
import { TournamentStatus } from '../lib/types.js';

export async function countTournamentTitles(db: Db, playerId: string): Promise<number> {
  const tournaments = await db.tournament.findMany({
    where: { status: TournamentStatus.FINISHED, winnerEntryId: { not: null } },
    select: { winnerEntryId: true },
  });
  const ids = tournaments.map((t) => t.winnerEntryId!);
  if (ids.length === 0) return 0;
  return db.tournamentEntry.count({
    where: {
      id: { in: ids },
      OR: [{ playerId }, { team: { members: { some: { playerId } } } }],
    },
  });
}

/** Verifica e grava conquistas novas do jogador. */
export async function checkAchievements(
  db: Db,
  playerId: string,
  extra: { lastWinRatingGap?: number; currentStreak?: number } = {},
): Promise<Achievement[]> {
  const [stats, owned, tournamentTitles, seasonTitles] = await Promise.all([
    db.playerSeasonStats.findMany({ where: { playerId } }),
    db.playerAchievement.findMany({ where: { playerId }, select: { key: true } }),
    countTournamentTitles(db, playerId),
    db.season.count({ where: { championId: playerId } }),
  ]);
  const totalWins = stats.reduce((s, x) => s + x.wins, 0);
  const totalMatches = stats.reduce((s, x) => s + x.wins + x.losses, 0);
  const unlocked = newlyUnlocked(
    {
      totalWins,
      totalMatches,
      currentStreak: extra.currentStreak ?? 0,
      tournamentTitles,
      seasonTitles,
      lastWinRatingGap: extra.lastWinRatingGap,
    },
    new Set(owned.map((o) => o.key)),
  );
  for (const a of unlocked) {
    await db.playerAchievement.create({ data: { playerId, key: a.key } });
  }
  return unlocked;
}
