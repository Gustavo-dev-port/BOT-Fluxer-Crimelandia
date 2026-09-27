export interface Tier {
  name: string;
  emoji: string;
  min: number;
}

/** Cada liga cobre 200 de rating, dividida em III / II / I. */
export const TIERS: Tier[] = [
  { name: 'Ferro', emoji: '⚙️', min: -Infinity },
  { name: 'Bronze', emoji: '🟫', min: 1000 },
  { name: 'Prata', emoji: '⚪', min: 1200 },
  { name: 'Ouro', emoji: '🟡', min: 1400 },
  { name: 'Platina', emoji: '🔷', min: 1600 },
  { name: 'Diamante', emoji: '💎', min: 1800 },
  { name: 'Mestre', emoji: '👑', min: 2000 },
];

const DIVISIONS = ['III', 'II', 'I'];
const TIER_WIDTH = 200;

export function tierFor(rating: number): { label: string; emoji: string } {
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) index = i;
  const tier = TIERS[index];

  // Ferro e Mestre não têm divisões.
  if (index === 0 || index === TIERS.length - 1) return { label: tier.name, emoji: tier.emoji };

  const offset = rating - tier.min;
  const division = Math.min(2, Math.floor(offset / (TIER_WIDTH / 3)));
  return { label: `${tier.name} ${DIVISIONS[division]}`, emoji: tier.emoji };
}

export interface TierProgress {
  /** Próxima divisão ou liga; null no topo (Mestre). */
  next: string | null;
  /** 0–100 dentro da divisão atual. */
  percent: number;
  /** Rating que falta para a próxima divisão. */
  remaining: number;
}

/** Quanto falta para subir de divisão. Ferro conta de 800 a 1000. */
export function tierProgress(rating: number): TierProgress {
  const pct = (from: number, to: number) => Math.max(0, Math.min(100, Math.floor(((rating - from) / (to - from)) * 100)));
  const bronze = TIERS[1].min;
  if (rating < bronze) return { next: tierFor(bronze).label, percent: pct(bronze - TIER_WIDTH, bronze), remaining: bronze - rating };
  const master = TIERS[TIERS.length - 1].min;
  if (rating >= master) return { next: null, percent: 100, remaining: 0 };

  const tier = [...TIERS].reverse().find((t) => rating >= t.min)!;
  const step = TIER_WIDTH / 3;
  const division = Math.min(2, Math.floor((rating - tier.min) / step));
  const start = tier.min + division * step;
  const end = division === 2 ? tier.min + TIER_WIDTH : start + step;
  return { next: tierFor(Math.ceil(end)).label, percent: pct(start, end), remaining: Math.ceil(end - rating) };
}
