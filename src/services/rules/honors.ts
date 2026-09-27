/**
 * Títulos de honra e classe do perfil medieval. São calculados a partir das
 * estatísticas (nada é gravado), então quem já cumpre a regra ganha o título na hora.
 */

export interface HonorContext {
  careerMatches: number;
  careerWins: number;
  /** Vitórias em duelos 1v1 (todas as temporadas). */
  duelWins: number;
  /** Maior sequência de vitórias em qualquer temporada. */
  bestStreakEver: number;
  seasonTitles: number;
  tournamentTitles: number;
  /** Rating da temporada atual. */
  rating: number;
}

export interface HonorTitle {
  key: string;
  emoji: string;
  name: string;
  requirement: string;
  /** Progresso até o título: atual e alvo (conquistado quando current >= target). */
  progress: (ctx: HonorContext) => { current: number; target: number };
}

export const HONOR_TITLES: HonorTitle[] = [
  {
    key: 'champion',
    emoji: '👑',
    name: 'Campeão do Reino',
    requirement: 'Termine uma temporada em 1º',
    progress: (c) => ({ current: c.seasonTitles, target: 1 }),
  },
  {
    key: 'gladiator',
    emoji: '⚔️',
    name: 'Gladiador',
    requirement: 'Jogue 50 partidas',
    progress: (c) => ({ current: c.careerMatches, target: 50 }),
  },
  {
    key: 'archmage',
    emoji: '🧙',
    name: 'Arquimago',
    requirement: 'Alcance 1600 de rating (Platina)',
    // Conta a partir do rating inicial (1000) para a barra não começar cheia.
    progress: (c) => ({ current: Math.max(0, c.rating - 1000), target: 600 }),
  },
  {
    key: 'lone_wolf',
    emoji: '🐺',
    name: 'Lobo Solitário',
    requirement: 'Vença 25 duelos 1v1',
    progress: (c) => ({ current: c.duelWins, target: 25 }),
  },
  {
    key: 'unstoppable',
    emoji: '🔥',
    name: 'Imparável',
    requirement: 'Vença 10 partidas seguidas',
    progress: (c) => ({ current: c.bestStreakEver, target: 10 }),
  },
];

export interface HonorStatus {
  title: HonorTitle;
  earned: boolean;
  current: number;
  target: number;
}

export function honorStatus(ctx: HonorContext): HonorStatus[] {
  return HONOR_TITLES.map((title) => {
    const { current, target } = title.progress(ctx);
    return { title, earned: current >= target, current: Math.min(current, target), target };
  });
}

export interface PlayerClass {
  emoji: string;
  name: string;
  description: string;
}

/**
 * Classe pelo estilo de jogo:
 * - Recruta: menos de 5 partidas
 * - Estrategista: vence 60% ou mais
 * - Berserker: joga muito (30+) e vence menos da metade
 * - Cavaleiro: o resto
 */
export function playerClass(ctx: Pick<HonorContext, 'careerMatches' | 'careerWins'>): PlayerClass {
  const { careerMatches: matches, careerWins: wins } = ctx;
  if (matches < 5) return { emoji: '🪖', name: 'Recruta', description: 'Ainda aprendendo o caminho da espada' };
  const winRate = wins / matches;
  if (winRate >= 0.6) return { emoji: '🧠', name: 'Estrategista', description: 'Vence mais do que perde' };
  if (matches >= 30 && winRate < 0.5) return { emoji: '🪓', name: 'Berserker', description: 'Nunca foge de uma batalha' };
  return { emoji: '🛡️', name: 'Cavaleiro', description: 'Firme em qualquer duelo' };
}
