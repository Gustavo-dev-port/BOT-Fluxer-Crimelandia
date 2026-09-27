/**
 * Bits de permissão do Fluxer (docs: /http-api/permissions).
 * Máscaras trafegam como strings decimais de 64 bits, então usamos BigInt.
 */
import type { Role, Snowflake } from './types.js';

export const Permission = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  PIN_MESSAGES: 1n << 51n,
} as const;

const ALL = (1n << 64n) - 1n;

/**
 * Permissões de um membro no servidor (sem sobrescritas de canal), conforme
 * "Permission computation": dono tem tudo; senão, @everyone (id = id do
 * servidor) ∪ cargos do membro; ADMINISTRATOR concede tudo.
 */
export function computeGuildPermissions(
  guildId: Snowflake,
  ownerId: Snowflake,
  userId: Snowflake,
  memberRoleIds: Snowflake[],
  roles: Role[],
): bigint {
  if (userId === ownerId) return ALL;
  const byId = new Map(roles.map((r) => [r.id, r]));
  let perms = BigInt(byId.get(guildId)?.permissions ?? '0');
  for (const id of memberRoleIds) perms |= BigInt(byId.get(id)?.permissions ?? '0');
  if (perms & Permission.ADMINISTRATOR) return ALL;
  return perms;
}

export function has(perms: bigint, bit: bigint): boolean {
  return (perms & bit) === bit;
}

/** Posição do cargo mais alto do membro (0 = só @everyone). */
export function highestRolePosition(memberRoleIds: Snowflake[], roles: Role[]): number {
  const ids = new Set(memberRoleIds);
  return roles.filter((r) => ids.has(r.id)).reduce((max, r) => Math.max(max, r.position), 0);
}

/** Bots precisam destas permissões; serve para montar o link de convite. */
export const BOT_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.EMBED_LINKS |
  Permission.ADD_REACTIONS |
  Permission.READ_MESSAGE_HISTORY |
  Permission.MENTION_EVERYONE |
  Permission.PIN_MESSAGES |
  Permission.MANAGE_ROLES |
  Permission.MANAGE_NICKNAMES |
  Permission.MANAGE_CHANNELS;
