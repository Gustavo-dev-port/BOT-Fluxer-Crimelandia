/**
 * Liga os eventos do Gateway às ações do bot:
 * - MESSAGE_CREATE → comandos de texto (`!duelo`, `!rank`…)
 * - MESSAGE_REACTION_ADD/REMOVE → reações que substituem botões (✅/❌/⚠️) e inscrições por ✅
 */
import { findCommand } from '../commands/index.js';
import { CommandContext, refOf, usageOf } from '../commands/types.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { FluxerClient } from '../fluxer/client.js';
import type { MessageCreateEvent, MessagePayload, ReactionEvent, User } from '../fluxer/types.js';
import { parseCommand } from '../lib/args.js';
import { TournamentStatus, UserError } from '../lib/types.js';
import { getSetting } from '../services/settings.js';
import { findByMessage, register, unregister } from '../services/tournaments.js';
import { Emoji } from './announcer.js';
import { type Actor, handleAccept, handleConfirm, handleDecline, handleDispute } from './duelActions.js';
import { mention } from './format.js';
import { JOIN_EMOJI, refreshTournamentMessage } from './tournamentView.js';

/** Comandos que admins usam em qualquer canal, mesmo com a restrição a #comandos. */
const ANYWHERE = new Set(['setup', 'admin']);

export async function onMessageCreate(client: FluxerClient, message: MessageCreateEvent) {
  if (message.guild_id !== client.guildId) return; // só o servidor configurado; ignora DMs
  if (message.author.bot || message.webhook_id) return;

  const parsed = parseCommand(message.content, config.prefix);
  if (!parsed) return;
  const command = findCommand(parsed.name);
  if (!command) return;

  const ctx = new CommandContext(client, message, parsed.name, parsed.args, parsed.rest);
  ctx.usageText = usageOf(command);
  try {
    if (command.adminOnly) await ctx.requireAdmin();
    if (config.restrictToCommandsChannel && !ANYWHERE.has(command.name) && !(await ctx.isAdmin())) {
      const allowed = await getSetting('channel:commands');
      if (allowed && message.channel_id !== allowed) throw new UserError(`Use os comandos do bot em <#${allowed}>.`);
    }
    await command.execute(ctx);
  } catch (err) {
    const text = err instanceof UserError ? `❌ ${err.message}` : '❌ Algo deu errado. Tente novamente em instantes.';
    if (!(err instanceof UserError)) console.error(`[comando ${command.name}]`, err);
    await ctx.reply(text).catch((e) => console.error('[comando] falha ao responder:', e));
  }
}

async function userOf(client: FluxerClient, event: ReactionEvent): Promise<User> {
  return event.member?.user ?? (await client.rest.getUser(event.user_id));
}

/** Uma reação num prompt de partida age como o botão correspondente. */
async function handlePromptReaction(client: FluxerClient, event: ReactionEvent): Promise<boolean> {
  const prompt = await prisma.reactionPrompt.findUnique({ where: { messageId: event.message_id } });
  if (!prompt) return false;

  // O emoji pode vir com ou sem o seletor de variação (U+FE0F); compara sem ele.
  const bare = (e: string) => e.replace(/\uFE0F/g, '');
  type Handler = (actor: Actor, matchId?: number | null) => Promise<void>;
  const actions: [string, Handler][] =
    prompt.kind === 'challenge'
      ? [
          [Emoji.YES, handleAccept],
          [Emoji.NO, handleDecline],
        ]
      : [
          [Emoji.YES, handleConfirm],
          [Emoji.DISPUTE, handleDispute],
        ];
  const action = actions.find(([e]) => bare(e) === bare(event.emoji.name))?.[1];
  if (!action) return true;

  const actor: Actor = {
    client,
    userId: event.user_id,
    // Edita a própria mensagem do prompt, como um botão faria.
    respond: (payload: MessagePayload) => client.rest.editMessage(prompt.channelId, prompt.messageId, { ...payload, allowed_mentions: { parse: [] } }),
  };
  try {
    await action(actor, prompt.matchId);
  } catch (err) {
    if (!(err instanceof UserError)) {
      console.error('[reação] erro:', err);
      return true;
    }
    // Só avisa quem participa da partida; reações de curiosos são ignoradas.
    const isParticipant = await prisma.matchParticipant.count({ where: { matchId: prompt.matchId, playerId: event.user_id } });
    if (isParticipant) await client.send(event.channel_id, `${mention(event.user_id)} ❌ ${err.message}`).catch(() => undefined);
  }
  return true;
}

export async function onReaction(client: FluxerClient, event: ReactionEvent, added: boolean) {
  if (event.guild_id !== client.guildId || event.user_id === client.botId) return;
  try {
    if (added && (await handlePromptReaction(client, event))) return;

    // ✅ no anúncio de um campeonato individual inscreve; tirar a reação desinscreve.
    if (event.emoji.name.replace(/️/g, '') !== JOIN_EMOJI) return;
    const tournament = await findByMessage(event.message_id);
    if (!tournament || tournament.status !== TournamentStatus.REGISTRATION || tournament.teamSize !== 1) return;
    if (added) {
      const user = await userOf(client, event);
      if (user.bot) return;
      await register(tournament.id, refOf(user));
    } else {
      await unregister(tournament.id, event.user_id);
    }
    await refreshTournamentMessage(client, tournament.id);
  } catch (err) {
    if (!(err instanceof UserError)) console.error('[reação] erro:', err);
  }
}
