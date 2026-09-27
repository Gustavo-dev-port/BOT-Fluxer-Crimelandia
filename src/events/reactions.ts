/** MESSAGE_REACTION_ADD/REMOVE: reações que substituem botões (✅/❌/⚠️) e inscrições por ✅. */
import { refOf } from '../commands/types.js';
import { prisma } from '../database/client.js';
import type { FluxerClient } from '../fluxer/client.js';
import type { MessagePayload, ReactionEvent, User } from '../fluxer/types.js';
import { TournamentStatus, UserError } from '../types/domain.js';
import { findByMessage, register, unregister } from '../services/tournaments.js';
import { Emoji } from '../embeds/matchEmbeds.js';
import { type Actor, handleAccept, handleConfirm, handleDecline, handleDispute } from '../services/notifications/duelActions.js';
import { mention } from '../embeds/format.js';
import { refreshTournamentMessage } from '../services/notifications/tournamentAnnouncer.js';
import { JOIN_EMOJI } from '../embeds/tournamentEmbed.js';
import { trackReaction } from '../services/notifications/missionTracker.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('reações');

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
    respond: (payload: MessagePayload) =>
      client.rest.editMessage(prompt.channelId, prompt.messageId, { ...payload, allowed_mentions: { parse: [] } }),
  };
  try {
    await action(actor, prompt.matchId);
  } catch (err) {
    if (!(err instanceof UserError)) {
      log.error('erro ao tratar reação', errorMeta(err));
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
  if (added) void trackReaction(client, event);
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
    if (!(err instanceof UserError)) log.error('erro ao tratar reação', errorMeta(err));
  }
}
