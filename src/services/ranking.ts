import { config } from '../config.js';
import type { Db } from '../db.js';

export type RankingMode = 'pontos' | 'elo';

export interface RankingRow {
  position: number;
  playerId: string;
  username: string;
  rating: number;
  points: number;
  wins: number;
  losses: number;
  streak: number;
}

function orderBy(mode: RankingMode) {
  return mode === 'elo'
    ? [{ rating: 'desc' as const }, { wins: 'desc' as const }, { losses: 'asc' as const }]
    : [{ points: 'desc' as const }, { rating: 'desc' as const }, { wins: 'desc' as const }];
}

/** Ranking da temporada. Só entra quem jogou ao menos uma partida. */
export async function getRanking(db: Db, seasonId: number, opts: { limit?: number; mode?: RankingMode } = {}): Promise<RankingRow[]> {
  const rows = await db.playerSeasonStats.findMany({
    where: { seasonId, OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }] },
    include: { player: true },
    orderBy: orderBy(opts.mode ?? config.rankingMode),
    take: opts.limit,
  });
  return rows.map((r, i) => ({
    position: i + 1,
    playerId: r.playerId,
    username: r.player.username,
    rating: r.rating,
    points: r.points,
    wins: r.wins,
    losses: r.losses,
    streak: r.streak,
  }));
}

export async function getPosition(db: Db, seasonId: number, playerId: string): Promise<number | null> {
  const ranking = await getRanking(db, seasonId);
  return ranking.find((r) => r.playerId === playerId)?.position ?? null;
}

/** Valor principal exibido no ranking conforme o modo. */
export function rankingValue(row: Pick<RankingRow, 'rating' | 'points'>, mode: RankingMode = config.rankingMode): string {
  return mode === 'elo' ? `${row.rating}` : `${row.points} pts`;
}
