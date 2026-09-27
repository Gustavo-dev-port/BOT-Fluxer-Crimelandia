import { Colors, mention } from '../embeds/format.js';
import { MAX_USER_LIMIT } from '../services/rules/voiceRooms.js';
import {
  allowIntoRoom,
  closeRoom,
  createRoom,
  joinWithPassword,
  kickFromRoom,
  renameRoom,
  requireOwnRoom,
  roomOfOwner,
  setRoomLimit,
  setRoomPrivate,
  setRoomPublic,
  transferRoom,
} from '../services/notifications/voiceRooms.js';
import { voicePresence } from '../services/voicePresence.js';
import { UserError } from '../types/domain.js';
import { refOf, type Command, type CommandContext } from './types.js';

/** Apaga a mensagem que tinha uma senha (se o bot puder), para ela não ficar no chat. */
async function hideMessage(ctx: CommandContext) {
  await ctx.client.rest.deleteMessage(ctx.channelId, ctx.message.id, 'Mensagem com senha de grupo').catch(() => undefined);
}

/** Texto depois do subcomando, preservando espaços. */
function afterSub(ctx: CommandContext): string {
  return ctx.rest.replace(/^\S+\s*/, '').trim();
}

export const grupo: Command = {
  name: 'grupo',
  aliases: ['sala', 'group'],
  category: 'Times e campeonatos',
  usage: '[nome|limite|privado|publico|senha|convidar|entrar|expulsar|lider|info|fechar]',
  description: 'Cria e administra sua sala de voz temporária ("Grupo do <nome>"), apagada quando fica vazia',
  details: [
    '`!grupo` ou `!grupo criar [nome]` — cria a sala',
    '`!grupo nome <novo nome>` · `!grupo limite <0-99>` (0 = sem limite)',
    '`!grupo privado [senha]` · `!grupo publico` · `!grupo senha <senha|limpar>`',
    '`!grupo convidar @amigo` — libera um amigo no grupo privado',
    '`!grupo entrar @líder <senha>` — entra num grupo privado com senha',
    '`!grupo expulsar @membro` · `!grupo lider @membro` (transfere a liderança)',
    '`!grupo info` · `!grupo fechar`',
    'Mensagens com senha são apagadas pelo bot (se ele tiver Gerenciar Mensagens).',
  ],
  async execute(ctx) {
    const sub = (ctx.args[0] ?? 'criar').toLowerCase();
    const client = ctx.client;

    if (sub === 'criar') {
      const room = await createRoom(client, refOf(ctx.author), afterSub(ctx) || undefined);
      await ctx.reply({
        embeds: [
          {
            color: Colors.forest,
            title: `🔊 ${room.name}`,
            description: `Sala criada: <#${room.channelId}>. Entre nela! Se ficar vazia, ela some sozinha.\nAjustes: \`!grupo nome\`, \`!grupo limite\`, \`!grupo privado\`… (\`!ajuda grupo\`)`,
          },
        ],
      });
      return;
    }

    if (sub === 'entrar') {
      const [leader] = await ctx.mentionedUsers();
      const password = ctx.args.slice(1).find((a) => !/^<@!?\d+>$/.test(a));
      await hideMessage(ctx);
      if (!leader || !password) throw new UserError('Use `!grupo entrar @líder <senha>`.');
      const room = await roomOfOwner(leader.id);
      if (!room) throw new UserError(`${mention(leader.id)} não lidera nenhum grupo.`);
      await joinWithPassword(client, room, ctx.author.id, password);
      await ctx.reply(`🔓 Entrada liberada em <#${room.channelId}>.`);
      return;
    }

    const room = await requireOwnRoom(ctx.author.id);
    switch (sub) {
      case 'nome': {
        const updated = await renameRoom(client, room, afterSub(ctx));
        await ctx.reply(`✏️ Grupo renomeado para **${updated.name}**.`);
        return;
      }
      case 'limite': {
        const limit = Number(ctx.args[1]);
        const updated = await setRoomLimit(client, room, limit);
        await ctx.reply(updated.userLimit ? `👥 Limite: **${updated.userLimit}** pessoas.` : '👥 Sem limite de pessoas.');
        return;
      }
      case 'privado': {
        const password = afterSub(ctx) || null;
        if (password) await hideMessage(ctx);
        await setRoomPrivate(client, room, password);
        await ctx.reply(
          password
            ? '🔒 Grupo privado com senha. Amigos entram com `!grupo entrar @você <senha>` ou pelo seu `!grupo convidar`.'
            : '🔒 Grupo privado. Libere amigos com `!grupo convidar @amigo`.',
        );
        return;
      }
      case 'publico':
      case 'público': {
        await setRoomPublic(client, room);
        await ctx.reply('🔓 Grupo público: qualquer um pode entrar.');
        return;
      }
      case 'senha': {
        const value = afterSub(ctx);
        if (!value) throw new UserError('Use `!grupo senha <senha>` ou `!grupo senha limpar`.');
        const clear = value.toLowerCase() === 'limpar';
        if (!clear) await hideMessage(ctx);
        await setRoomPrivate(client, room, clear ? null : value);
        await ctx.reply(clear ? '🔒 Senha removida (o grupo continua privado).' : '🔑 Senha definida; o grupo agora é privado.');
        return;
      }
      case 'convidar': {
        const target = await ctx.requireUser(0, 'amigo');
        await allowIntoRoom(client, room, target.id);
        await ctx.reply({
          content: `🤝 ${mention(target.id)}, você foi convidado para <#${room.channelId}>!`,
          allowed_mentions: { users: [target.id] },
        });
        return;
      }
      case 'expulsar': {
        const target = await ctx.requireUser(0, 'membro');
        await kickFromRoom(client, room, target.id);
        await ctx.reply({ content: `🥾 ${mention(target.id)} foi expulso do grupo.`, allowed_mentions: { parse: [] } });
        return;
      }
      case 'lider':
      case 'líder': {
        const target = await ctx.requireUser(0, 'membro');
        await transferRoom(room, refOf(target));
        await ctx.reply({ content: `👑 ${mention(target.id)} agora lidera **${room.name}**.`, allowed_mentions: { users: [target.id] } });
        return;
      }
      case 'info': {
        const members = voicePresence.members(room.channelId);
        await ctx.reply({
          allowed_mentions: { parse: [] },
          embeds: [
            {
              color: Colors.forest,
              title: `🔊 ${room.name}`,
              description: [
                `Sala: <#${room.channelId}>`,
                `👑 Líder: ${mention(room.ownerId)}`,
                `👥 Limite: ${room.userLimit || 'sem limite'} (máx. ${MAX_USER_LIMIT})`,
                room.isPrivate ? `🔒 Privado${room.passwordHash ? ' com senha' : ''}` : '🔓 Público',
                `Na sala agora (${members.length}): ${members.map(mention).join(', ') || '_ninguém_'}`,
              ].join('\n'),
            },
          ],
        });
        return;
      }
      case 'fechar': {
        await closeRoom(client, room, 'Fechado pelo líder');
        await ctx.reply('🚪 Grupo fechado.');
        return;
      }
      default:
        throw new UserError('Subcomando desconhecido. Veja `!ajuda grupo`.');
    }
  },
};
