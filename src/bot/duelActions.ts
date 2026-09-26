import { EmbedBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type InteractionReplyOptions } from 'discord.js';
import {
  acceptDuel,
  confirmResult,
  declineDuel,
  disputeResult,
  type MatchWithParticipants,
  playersOnSide,
} from '../services/matches.js';
import { afterMatchConfirmed, announceDisputed, resultEmbed } from './announcer.js';
import { Colors, mention, versus } from './format.js';

type Source = ChatInputCommandInteraction | ButtonInteraction;

/** Botões atualizam a própria mensagem; comandos respondem com uma nova. */
async function respond(interaction: Source, payload: Omit<InteractionReplyOptions, 'flags'>) {
  if (interaction.isButton()) {
    await interaction.update({ content: payload.content ?? null, embeds: payload.embeds, components: payload.components ?? [] });
  } else {
    await interaction.reply(payload);
  }
}

export async function acceptedEmbed(match: MatchWithParticipants) {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle(`🎮 Partida #${match.id} aceita — ${match.game}`)
    .setDescription(`${await versus(match)}\n\nBom jogo! Ao terminar, qualquer um registra com **/resultado vencedor:@fulano**.`);
}

export async function handleAccept(interaction: Source, matchId?: number | null) {
  const match = await acceptDuel(interaction.user.id, matchId);
  await respond(interaction, {
    content: playersOnSide(match, 1).map(mention).join(' '),
    embeds: [await acceptedEmbed(match)],
  });
}

export async function handleDecline(interaction: Source, matchId?: number | null) {
  const match = await declineDuel(interaction.user.id, matchId);
  await respond(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.danger)
        .setTitle(`❌ Desafio #${match.id} recusado`)
        .setDescription(`${mention(interaction.user.id)} recusou o desafio (${await versus(match)}).`),
    ],
  });
}

export async function handleConfirm(interaction: Source, matchId?: number | null) {
  const result = await confirmResult(interaction.user.id, matchId);
  await respond(interaction, { embeds: [await resultEmbed(result)] });
  await afterMatchConfirmed(interaction.client, result);
}

export async function handleDispute(interaction: Source, matchId?: number | null) {
  const match = await disputeResult(interaction.user.id, matchId);
  await respond(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.danger)
        .setTitle(`⚠️ Resultado da partida #${match.id} contestado`)
        .setDescription('Um admin vai analisar e definir o resultado com **/admin resultado**.'),
    ],
  });
  await announceDisputed(interaction.client, match);
}
