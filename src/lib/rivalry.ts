export interface DuelRecord {
  opponentId: string;
  won: boolean;
  playedAt: Date;
}

export interface Rivalry {
  opponentId: string;
  total: number;
  wins: number;
  losses: number;
  lastPlayedAt: Date;
}

/** Agrupa confrontos 1v1 por adversário, do mais enfrentado para o menos. */
export function computeRivalries(records: DuelRecord[]): Rivalry[] {
  const map = new Map<string, Rivalry>();
  for (const r of records) {
    const current = map.get(r.opponentId) ?? {
      opponentId: r.opponentId,
      total: 0,
      wins: 0,
      losses: 0,
      lastPlayedAt: r.playedAt,
    };
    current.total++;
    if (r.won) current.wins++;
    else current.losses++;
    if (r.playedAt > current.lastPlayedAt) current.lastPlayedAt = r.playedAt;
    map.set(r.opponentId, current);
  }
  // Mais partidas; empate → confronto mais equilibrado; depois o mais recente.
  return [...map.values()].sort(
    (a, b) =>
      b.total - a.total ||
      Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses) ||
      b.lastPlayedAt.getTime() - a.lastPlayedAt.getTime(),
  );
}

/** "hoje", "ontem", "há 3 dias"... */
export function relativeDay(date: Date, now: Date = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}
