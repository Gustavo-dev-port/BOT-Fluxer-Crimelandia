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
