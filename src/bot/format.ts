import { prisma } from '../db.js';
import type { MatchWithParticipants } from '../services/matches.js';
import { playersOnSide } from '../services/matches.js';
import type { Side } from '../lib/types.js';

export const Colors = {
  primary: 0x7c3aed,
  success: 0x22c55e,
  warning: 0xf59e0b,
  danger: 0xef4444,
  info: 0x3b82f6,
  gold: 0xfacc15,
} as const;

export const MEDALS = ['🥇', '🥈', '🥉'];

export function medal(position: number): string {
  return MEDALS[position - 1] ?? `**${position}.**`;
}

export const mention = (id: string) => `<@${id}>`;

/** "Time X" ou "@a, @b" para um lado da partida. */
export async function sideLabel(match: MatchWithParticipants, side: Side): Promise<string> {
  const teamId = side === 1 ? match.team1Id : match.team2Id;
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (team) return `**${team.name}**`;
  }
  return playersOnSide(match, side).map(mention).join(', ');
}

export async function versus(match: MatchWithParticipants): Promise<string> {
  return `${await sideLabel(match, 1)} ⚔️ ${await sideLabel(match, 2)}`;
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function discordTime(date: Date, style: 'R' | 'f' | 'D' = 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: '⏳ Aguardando aceite',
  ACCEPTED: '🎮 Em andamento',
  AWAITING_CONFIRMATION: '📝 Aguardando confirmação',
  DISPUTED: '⚠️ Em disputa',
  CONFIRMED: '✅ Confirmada',
  DECLINED: '❌ Recusada',
  CANCELLED: '🚫 Cancelada',
  EXPIRED: '⌛ Expirada',
  WAITING: '🕓 Aguardando adversário',
};
