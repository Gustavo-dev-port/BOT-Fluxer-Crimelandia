export interface AchievementContext {
  totalWins: number;
  totalMatches: number;
  currentStreak: number;
  tournamentTitles: number;
  seasonTitles: number;
  /** Diferença de rating do adversário na vitória mais recente (adversário − você). */
  lastWinRatingGap?: number;
}

export interface Achievement {
  key: string;
  name: string;
  emoji: string;
  description: string;
  check: (ctx: AchievementContext) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { key: 'first_win', name: 'Primeira Vitória', emoji: '🎉', description: 'Vença seu primeiro duelo', check: (c) => c.totalWins >= 1 },
  { key: 'wins_10', name: 'Veterano', emoji: '🎖️', description: 'Vença 10 partidas', check: (c) => c.totalWins >= 10 },
  { key: 'wins_50', name: 'Lenda', emoji: '🏛️', description: 'Vença 50 partidas', check: (c) => c.totalWins >= 50 },
  { key: 'matches_25', name: 'Viciado', emoji: '🕹️', description: 'Jogue 25 partidas', check: (c) => c.totalMatches >= 25 },
  { key: 'streak_5', name: 'Em Chamas', emoji: '🔥', description: '5 vitórias seguidas', check: (c) => c.currentStreak >= 5 },
  { key: 'streak_10', name: 'Imparável', emoji: '⚡', description: '10 vitórias seguidas', check: (c) => c.currentStreak >= 10 },
  {
    key: 'giant_killer',
    name: 'Mata-Gigante',
    emoji: '🗡️',
    description: 'Vença alguém com 200+ de rating a mais',
    check: (c) => (c.lastWinRatingGap ?? 0) >= 200,
  },
  {
    key: 'tournament_champ',
    name: 'Campeão de Torneio',
    emoji: '🏆',
    description: 'Vença um campeonato',
    check: (c) => c.tournamentTitles >= 1,
  },
  {
    key: 'season_champ',
    name: 'Campeão da Temporada',
    emoji: '👑',
    description: 'Termine uma temporada em 1º',
    check: (c) => c.seasonTitles >= 1,
  },
];

/** Conquistas que o contexto satisfaz e o jogador ainda não tem. */
export function newlyUnlocked(ctx: AchievementContext, owned: Set<string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !owned.has(a.key) && a.check(ctx));
}
