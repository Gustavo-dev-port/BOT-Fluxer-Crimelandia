/**
 * Salas de voz temporárias (!grupo): regras puras.
 */
import { createHash } from 'node:crypto';

/** Sala criada e ninguém entrou: tempo até apagar. */
export const NEW_ROOM_GRACE_MS = 5 * 60_000;
/** Sala que já teve gente e esvaziou: tempo até apagar. */
export const EMPTY_ROOM_GRACE_MS = 60_000;
export const MAX_USER_LIMIT = 99;

/** "Grupo do Gustavo" (limite de 100 caracteres do Fluxer). */
export function defaultRoomName(displayName: string): string {
  return roomName(`Grupo do ${displayName}`);
}

/** Nome válido para a sala: sem quebras de linha, 1–100 caracteres. */
export function roomName(input: string): string {
  const name = input
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (!name) throw new Error('nome vazio');
  return name;
}

/** Senha guardada como hash, amarrada à sala. */
export function hashPassword(channelId: string, password: string): string {
  return createHash('sha256').update(`${channelId}:${password}`).digest('hex');
}

export function checkPassword(channelId: string, password: string, hash: string | null): boolean {
  return hash !== null && hashPassword(channelId, password) === hash;
}

/** A sala vazia já pode ser apagada? */
export function shouldDeleteRoom(room: { createdAt: Date; emptySince: Date | null }, occupants: number, now: Date): boolean {
  if (occupants > 0 || !room.emptySince) return false;
  const neverUsed = room.emptySince.getTime() === room.createdAt.getTime();
  return now.getTime() - room.emptySince.getTime() >= (neverUsed ? NEW_ROOM_GRACE_MS : EMPTY_ROOM_GRACE_MS);
}
