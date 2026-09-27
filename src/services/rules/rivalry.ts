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
  /** Confrontos mais recentes primeiro (no máximo HISTORY_SIZE). */
  history: { won: boolean; playedAt: Date }[];
}

export const HISTORY_SIZE = 5;

/** Ordem das rivalidades: mais partidas; empate → mais equilibrada; depois a mais recente. */
function byRivalry<T extends { total: number; lastPlayedAt: Date }>(balance: (x: T) => number) {
  return (a: T, b: T) => b.total - a.total || balance(a) - balance(b) || b.lastPlayedAt.getTime() - a.lastPlayedAt.getTime();
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
      history: [],
    };
    current.total++;
    if (r.won) current.wins++;
    else current.losses++;
    if (r.playedAt > current.lastPlayedAt) current.lastPlayedAt = r.playedAt;
    current.history.push({ won: r.won, playedAt: r.playedAt });
    map.set(r.opponentId, current);
  }
  for (const r of map.values()) {
    r.history.sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
    r.history.length = Math.min(r.history.length, HISTORY_SIZE);
  }
  return [...map.values()].sort(byRivalry((x) => Math.abs(x.wins - x.losses)));
}

/** Um duelo 1v1 confirmado, visto de fora (para as rivalidades da comunidade). */
export interface DuelResult {
  winnerId: string;
  loserId: string;
  playedAt: Date;
}

export interface PairRivalry {
  /** IDs em ordem fixa (menor primeiro) para o par ser único. */
  playerA: string;
  playerB: string;
  total: number;
  winsA: number;
  winsB: number;
  lastPlayedAt: Date;
}

/** Rivalidades entre todos os pares de jogadores, da mais disputada para a menos. */
export function computeCommunityRivalries(duels: DuelResult[], limit = 10): PairRivalry[] {
  const map = new Map<string, PairRivalry>();
  for (const d of duels) {
    const [a, b] = [d.winnerId, d.loserId].sort();
    const key = `${a}|${b}`;
    const pair = map.get(key) ?? { playerA: a, playerB: b, total: 0, winsA: 0, winsB: 0, lastPlayedAt: d.playedAt };
    pair.total++;
    if (d.winnerId === a) pair.winsA++;
    else pair.winsB++;
    if (d.playedAt > pair.lastPlayedAt) pair.lastPlayedAt = d.playedAt;
    map.set(key, pair);
  }
  return [...map.values()]
    .filter((p) => p.total >= 2)
    .sort(byRivalry((x) => Math.abs(x.winsA - x.winsB)))
    .slice(0, limit);
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
