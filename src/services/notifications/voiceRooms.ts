/**
 * Salas de voz temporárias (!grupo): criação, ajustes, expulsão, liderança e
 * limpeza automática das salas vazias.
 */
import type { VoiceRoom } from '../../generated/prisma/client.js';
import { prisma } from '../../database/client.js';
import type { FluxerClient } from '../../fluxer/client.js';
import { Permission } from '../../fluxer/permissions.js';
import { ChannelType, type PermissionOverwrite, type Snowflake } from '../../fluxer/types.js';
import { UserError } from '../../types/domain.js';
import { ensurePlayer, type PlayerRef } from '../players.js';
import { getChannelId } from '../channels.js';
import { checkPassword, defaultRoomName, hashPassword, MAX_USER_LIMIT, roomName, shouldDeleteRoom } from '../rules/voiceRooms.js';
import { todayKey } from '../missions.js';
import { voicePresence } from '../voicePresence.js';
import { trackMission } from './missionTracker.js';
import { errorMeta, scoped } from '../../utils/logger.js';
import { roomQueue } from '../../utils/queue.js';

const log = scoped('voz');
const CONNECT = Permission.CONNECT.toString();
const MEMBER = 1 as const;
const ROLE = 0 as const;

export function roomOfOwner(ownerId: string) {
  return prisma.voiceRoom.findFirst({ where: { ownerId } });
}

export function roomByChannel(channelId: string) {
  return prisma.voiceRoom.findUnique({ where: { channelId } });
}

/** Sala que o usuário lidera; erro amigável se não tiver. */
export async function requireOwnRoom(userId: string): Promise<VoiceRoom> {
  const room = await roomOfOwner(userId);
  if (!room) throw new UserError('Você não lidera nenhum grupo. Crie um com `!grupo`.');
  return room;
}

/** Cria a sala "Grupo do <nome>" na categoria do #comandos (se houver). */
export async function createRoom(client: FluxerClient, owner: PlayerRef, name?: string): Promise<VoiceRoom> {
  if (await roomOfOwner(owner.id)) throw new UserError('Você já tem um grupo aberto. Use `!grupo info` ou `!grupo fechar`.');
  await ensurePlayer(prisma, owner);
  let finalName: string;
  try {
    finalName = name ? roomName(name) : defaultRoomName(owner.username);
  } catch {
    throw new UserError('Nome de grupo inválido.');
  }
  const commands = await getChannelId(client, 'commands');
  const parent = commands
    ? (await client.rest.getGuildChannels(client.guildId).catch(() => [])).find((c) => c.id === commands)?.parent_id
    : null;
  const channel = await client.rest.createGuildChannel(
    client.guildId,
    { name: finalName, type: ChannelType.GUILD_VOICE, ...(parent ? { parent_id: parent } : {}) },
    `Grupo temporário de ${owner.username}`,
  );
  const now = new Date();
  const room = await prisma.voiceRoom.create({
    data: { channelId: channel.id, ownerId: owner.id, name: finalName, createdAt: now, emptySince: now },
  });
  log.info('grupo criado', { channel: channel.id, owner: owner.id, name: finalName });
  return room;
}

export async function renameRoom(client: FluxerClient, room: VoiceRoom, name: string) {
  let finalName: string;
  try {
    finalName = roomName(name);
  } catch {
    throw new UserError('Informe o novo nome: `!grupo nome <nome>`.');
  }
  await client.rest.modifyChannel(room.channelId, { name: finalName }, 'Grupo renomeado pelo líder');
  return prisma.voiceRoom.update({ where: { id: room.id }, data: { name: finalName } });
}

export async function setRoomLimit(client: FluxerClient, room: VoiceRoom, limit: number) {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_USER_LIMIT)
    throw new UserError(`O limite vai de 0 (sem limite) a ${MAX_USER_LIMIT}.`);
  await client.rest.modifyChannel(room.channelId, { user_limit: limit }, 'Limite do grupo');
  return prisma.voiceRoom.update({ where: { id: room.id }, data: { userLimit: limit } });
}

/** Privado: @everyone não conecta; o líder, quem já está na sala e o bot continuam podendo. */
export async function setRoomPrivate(client: FluxerClient, room: VoiceRoom, password: string | null) {
  const allowed = new Set([room.ownerId, ...voicePresence.members(room.channelId)]);
  if (client.botId) allowed.add(client.botId);
  const overwrites: PermissionOverwrite[] = [
    { id: client.guildId, type: ROLE, deny: CONNECT },
    ...[...allowed].map((id) => ({ id, type: MEMBER, allow: CONNECT })),
  ];
  await client.rest.modifyChannel(room.channelId, { permission_overwrites: overwrites }, 'Grupo privado');
  return prisma.voiceRoom.update({
    where: { id: room.id },
    data: { isPrivate: true, passwordHash: password ? hashPassword(room.channelId, password) : null },
  });
}

export async function setRoomPublic(client: FluxerClient, room: VoiceRoom) {
  await client.rest.modifyChannel(room.channelId, { permission_overwrites: [] }, 'Grupo público');
  return prisma.voiceRoom.update({ where: { id: room.id }, data: { isPrivate: false, passwordHash: null } });
}

/** Libera a entrada de alguém num grupo privado. */
export async function allowIntoRoom(client: FluxerClient, room: VoiceRoom, userId: Snowflake) {
  await client.rest.editChannelPermission(room.channelId, userId, { type: MEMBER, allow: CONNECT }, 'Convite para o grupo');
}

/** Entrar num grupo privado com a senha. */
export async function joinWithPassword(client: FluxerClient, room: VoiceRoom, userId: Snowflake, password: string) {
  if (!room.isPrivate) return; // público: é só entrar
  if (!checkPassword(room.channelId, password, room.passwordHash))
    throw new UserError('Senha incorreta (ou o grupo não usa senha: peça um convite ao líder).');
  await allowIntoRoom(client, room, userId);
}

/** Tira da sala e impede de voltar. */
export async function kickFromRoom(client: FluxerClient, room: VoiceRoom, userId: Snowflake) {
  if (userId === room.ownerId) throw new UserError('O líder não pode se expulsar. Transfira a liderança antes.');
  await client.rest.editChannelPermission(room.channelId, userId, { type: MEMBER, deny: CONNECT }, 'Expulso do grupo');
  if (voicePresence.channelOf(userId) === room.channelId) {
    await client.rest.modifyMember(client.guildId, userId, { channel_id: null }, 'Expulso do grupo');
  }
  log.info('expulso do grupo', { channel: room.channelId, user: userId });
}

export async function transferRoom(room: VoiceRoom, newOwner: PlayerRef) {
  if (newOwner.id === room.ownerId) throw new UserError('Você já é o líder.');
  if (voicePresence.channelOf(newOwner.id) !== room.channelId) throw new UserError('O novo líder precisa estar na sala.');
  if (await roomOfOwner(newOwner.id)) throw new UserError('Essa pessoa já lidera outro grupo.');
  await ensurePlayer(prisma, newOwner);
  log.info('liderança transferida', { channel: room.channelId, from: room.ownerId, to: newOwner.id });
  return prisma.voiceRoom.update({ where: { id: room.id }, data: { ownerId: newOwner.id } });
}

export async function closeRoom(client: FluxerClient, room: VoiceRoom, reason: string) {
  await client.rest
    .deleteChannel(room.channelId, reason)
    .catch((err: unknown) => log.warn('falha ao apagar o grupo', { channel: room.channelId, ...errorMeta(err) }));
  await prisma.voiceRoom.deleteMany({ where: { id: room.id } });
  log.info('grupo apagado', { channel: room.channelId, reason });
}

/** Marca as salas vazias e apaga as que passaram do prazo (chamado a cada minuto). */
export async function cleanupEmptyRooms(client: FluxerClient, now = new Date()) {
  for (const room of await prisma.voiceRoom.findMany()) {
    const occupants = voicePresence.count(room.channelId);
    if (occupants > 0) {
      if (room.emptySince) await prisma.voiceRoom.update({ where: { id: room.id }, data: { emptySince: null } });
    } else if (!room.emptySince) {
      await prisma.voiceRoom.update({ where: { id: room.id }, data: { emptySince: now } });
    } else if (shouldDeleteRoom(room, occupants, now)) {
      await closeRoom(client, room, 'Grupo vazio');
    }
  }
}

// Missão "Receba N amigos no seu grupo": cada amigo conta uma vez por dia por grupo.
const invitedToday = new Set<string>();
let invitedDay = '';

/**
 * Liga a presença em voz às salas temporárias (chamado uma vez na inicialização):
 * - entrar marca a sala como ocupada e conta a missão de grupo para o líder;
 * - o último a sair marca o início do prazo para apagar.
 */
export function trackRooms(client: FluxerClient) {
  voicePresence.listen({
    onJoin: (user, channelId) => {
      void roomQueue(async () => {
        const room = await roomByChannel(channelId);
        if (!room) return;
        if (room.emptySince) await prisma.voiceRoom.update({ where: { id: room.id }, data: { emptySince: null } });
        if (room.ownerId === user.id) return;
        const day = todayKey();
        if (day !== invitedDay) {
          invitedDay = day;
          invitedToday.clear();
        }
        const key = `${room.id}:${user.id}`;
        if (invitedToday.has(key)) return;
        invitedToday.add(key);
        void trackMission(client, room.ownerId, 'group_invite');
      }).catch((err: unknown) => log.error('falha ao registrar entrada no grupo', errorMeta(err)));
    },
    onLeave: (_user, channelId) => {
      // Contado agora, no momento do evento (quem entrar depois gera outro evento).
      const empty = voicePresence.count(channelId) === 0;
      const at = new Date();
      if (!empty) return;
      void roomQueue(() => prisma.voiceRoom.updateMany({ where: { channelId }, data: { emptySince: at } })).catch((err: unknown) =>
        log.error('falha ao marcar grupo vazio', errorMeta(err)),
      );
    },
  });
}
