import { config } from '../config.js';
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

/** Marcação de horário do Fluxer: `<t:unix:estilo>` (mostrada no fuso de quem lê). */
export function timeTag(date: Date, style: 'R' | 'f' | 'D' = 'R'): string {
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

/** 1500 → "25 min"; 4800 → "1h20". */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Nome de comando com o prefixo, em negrito: **!duelo** */
export const cmd = (name: string) => `**${config.prefix}${name}**`;

/** Corta texto para caber nos limites de embed. */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
