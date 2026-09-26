import type { FluxerClient } from '../fluxer/client.js';
import type { Message, MessagePayload, Snowflake } from '../fluxer/types.js';
import { acceptDuel, confirmResult, declineDuel, disputeResult, playersOnSide } from '../services/matches.js';
import { acceptedEmbed, afterMatchConfirmed, announceDisputed, resultEmbed, retirePrompts } from './announcer.js';
import { Colors, mention, versus } from './format.js';

/**
 * Quem agiu e como responder. Vindo de um comando, responde com uma nova
 * mensagem; vindo de uma reação, edita a própria mensagem reagida.
 */
export interface Actor {
  client: FluxerClient;
  userId: Snowflake;
  respond: (payload: MessagePayload) => Promise<Message | void>;
}

export async function handleAccept(actor: Actor, matchId?: number | null) {
  const match = await acceptDuel(actor.userId, matchId);
  await retirePrompts(actor.client, match.id);
  await actor.respond({
    content: playersOnSide(match, 1).map(mention).join(' '),
    embeds: [await acceptedEmbed(match)],
  });
}

export async function handleDecline(actor: Actor, matchId?: number | null) {
  const match = await declineDuel(actor.userId, matchId);
  await retirePrompts(actor.client, match.id);
  await actor.respond({
    content: '',
    embeds: [
      {
        color: Colors.danger,
        title: `❌ Desafio #${match.id} recusado`,
        description: `${mention(actor.userId)} recusou o desafio (${await versus(match)}).`,
      },
    ],
    allowed_mentions: { parse: [] },
  });
}

export async function handleConfirm(actor: Actor, matchId?: number | null) {
  const result = await confirmResult(actor.userId, matchId);
  await actor.respond({ content: '', embeds: [await resultEmbed(result)], allowed_mentions: { parse: [] } });
  await afterMatchConfirmed(actor.client, result);
}

export async function handleDispute(actor: Actor, matchId?: number | null) {
  const match = await disputeResult(actor.userId, matchId);
  await actor.respond({
    content: '',
    embeds: [
      {
        color: Colors.danger,
        title: `⚠️ Resultado da partida #${match.id} contestado`,
        description: 'Um admin vai analisar e definir o resultado.',
      },
    ],
  });
  await announceDisputed(actor.client, match);
}
