/**
 * Missões diárias: catálogo e sorteio das 3 missões do dia (lógica pura).
 * O sorteio usa o próprio dia como semente, então é o mesmo em qualquer reinício do bot.
 */

export type MissionKind = 'win_duels' | 'play_matches' | 'voice_minutes' | 'join_voice' | 'send_messages' | 'react_messages';

export interface MissionTier {
  target: number;
  /** FluxCoins (20–100). */
  reward: number;
}

export interface MissionType {
  kind: MissionKind;
  emoji: string;
  /** Texto da missão para um alvo, ex.: "Vença 2 duelos". */
  label: (target: number) => string;
  tiers: MissionTier[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const MISSION_TYPES: MissionType[] = [
  {
    kind: 'win_duels',
    emoji: '⚔️',
    label: (n) => `Vença ${n} ${plural(n, 'partida', 'partidas')}`,
    tiers: [
      { target: 1, reward: 30 },
      { target: 2, reward: 60 },
      { target: 3, reward: 90 },
    ],
  },
  {
    kind: 'play_matches',
    emoji: '🎮',
    label: (n) => `Jogue ${n} partidas`,
    tiers: [
      { target: 2, reward: 30 },
      { target: 3, reward: 40 },
      { target: 5, reward: 60 },
    ],
  },
  {
    kind: 'voice_minutes',
    emoji: '🎙️',
    label: (n) => `Permaneça ${n} minutos em voz`,
    tiers: [
      { target: 30, reward: 30 },
      { target: 60, reward: 60 },
      { target: 90, reward: 90 },
    ],
  },
  {
    kind: 'join_voice',
    emoji: '🚪',
    label: (n) => `Entre em ${n} salas de voz`,
    tiers: [
      { target: 2, reward: 30 },
      { target: 3, reward: 45 },
    ],
  },
  {
    kind: 'send_messages',
    emoji: '💬',
    label: (n) => `Envie ${n} mensagens no servidor`,
    tiers: [
      { target: 15, reward: 20 },
      { target: 30, reward: 35 },
      { target: 50, reward: 50 },
    ],
  },
  {
    kind: 'react_messages',
    emoji: '👍',
    label: (n) => `Reaja a ${n} mensagens`,
    tiers: [
      { target: 5, reward: 20 },
      { target: 10, reward: 30 },
    ],
  },
];

export const MISSIONS_PER_DAY = 3;

export function missionType(kind: string): MissionType | undefined {
  return MISSION_TYPES.find((t) => t.kind === kind);
}

/** Gerador pseudoaleatório determinístico (mulberry32) a partir de um texto. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h << 13) | (h >>> 19);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedMission extends MissionTier {
  kind: MissionKind;
}

/** 3 missões de tipos diferentes para o dia, sempre as mesmas para a mesma data. */
export function generateDailyMissions(dateKey: string, types: MissionType[] = MISSION_TYPES): GeneratedMission[] {
  const rand = seededRandom(dateKey);
  const pool = [...types];
  const picked: GeneratedMission[] = [];
  while (picked.length < MISSIONS_PER_DAY && pool.length) {
    const [type] = pool.splice(Math.floor(rand() * pool.length), 1);
    const tier = type.tiers[Math.floor(rand() * type.tiers.length)];
    picked.push({ kind: type.kind, ...tier });
  }
  return picked;
}
