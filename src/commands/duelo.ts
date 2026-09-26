import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { challengeButtons, challengeEmbed, afterMatchConfirmed, announceDisputed, awaitingEmbed, confirmButtons, resultEmbed } from '../bot/announcer.js';
import { handleAccept, handleConfirm, handleDecline, handleDispute } from '../bot/duelActions.js';
import { Colors, mention, STATUS_LABEL, versus } from '../bot/format.js';
import { UserError } from '../lib/types.js';
import { resolveGame } from '../services/games.js';
import { cancelDuel, createDuel, listOpenMatches, playersOnSide, reportResult } from '../services/matches.js';
import { autocompleteGame, type Command, isAdmin, refOf } from './types.js';

const matchOption = (b: SlashCommandBuilder) =>
  b.addIntegerOption((o) => o.setName('partida').setDescription('ID da partida (se você tiver mais de uma)').setMinValue(1));

export const duelo: Command = {
  data: new SlashCommandBuilder()
    .setName('duelo')
    .setDescription('Desafia um amigo para um duelo 1v1')
    .addUserOption((o) => o.setName('oponente').setDescription('Quem você quer desafiar').setRequired(true))
    .addStringOption((o) => o.setName('jogo').setDescription('Jogo da disputa').setRequired(true).setAutocomplete(true)),
  autocomplete: autocompleteGame,
  async execute(interaction) {
    const opponent = interaction.options.getUser('oponente', true);
    if (opponent.bot) throw new UserError('Bots não aceitam desafios. 🤖');
    const game = await resolveGame(interaction.options.getString('jogo', true));
    const match = await createDuel(refOf(interaction.user), refOf(opponent), game);
    await interaction.reply({
      content: mention(opponent.id),
      embeds: [await challengeEmbed(match)],
      components: [challengeButtons(match.id)],
    });
  },
};

export const aceitar: Command = {
  data: matchOption(new SlashCommandBuilder().setName('aceitar').setDescription('Aceita um desafio pendente')),
  execute: (i) => handleAccept(i, i.options.getInteger('partida')),
};

export const recusar: Command = {
  data: matchOption(new SlashCommandBuilder().setName('recusar').setDescription('Recusa um desafio pendente')),
  execute: (i) => handleDecline(i, i.options.getInteger('partida')),
};

export const cancelar: Command = {
  data: matchOption(new SlashCommandBuilder().setName('cancelar').setDescription('Cancela um desafio que você criou')),
  async execute(interaction) {
    const match = await cancelDuel(interaction.user.id, interaction.options.getInteger('partida'), isAdmin(interaction));
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.danger).setTitle(`🚫 Partida #${match.id} cancelada`).setDescription(await versus(match))],
    });
  },
};

export const resultado: Command = {
  data: new SlashCommandBuilder()
    .setName('resultado')
    .setDescription('Registra quem venceu a partida (o outro lado precisa confirmar)')
    .addUserOption((o) => o.setName('vencedor').setDescription('Quem venceu (em times, qualquer jogador do time vencedor)').setRequired(true))
    .addIntegerOption((o) => o.setName('partida').setDescription('ID da partida (se você tiver mais de uma)').setMinValue(1)),
  async execute(interaction) {
    const winner = interaction.options.getUser('vencedor', true);
    const outcome = await reportResult(interaction.user.id, winner.id, interaction.options.getInteger('partida'));

    if (outcome.kind === 'awaiting') {
      const confirmSide = outcome.match.reportedSide === 1 ? 2 : 1;
      await interaction.reply({
        content: playersOnSide(outcome.match, confirmSide).map(mention).join(' '),
        embeds: [await awaitingEmbed(outcome.match)],
        components: [confirmButtons(outcome.match.id)],
      });
    } else if (outcome.kind === 'confirmed') {
      await interaction.reply({ embeds: [await resultEmbed(outcome.result)] });
      await afterMatchConfirmed(interaction.client, outcome.result);
    } else {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.danger)
            .setTitle(`⚠️ Partida #${outcome.match.id} em disputa`)
            .setDescription('Os dois lados informaram vencedores diferentes. Um admin vai resolver.'),
        ],
      });
      await announceDisputed(interaction.client, outcome.match);
    }
  },
};

export const confirmar: Command = {
  data: matchOption(new SlashCommandBuilder().setName('confirmar').setDescription('Confirma o resultado informado pelo adversário')),
  execute: (i) => handleConfirm(i, i.options.getInteger('partida')),
};

export const contestar: Command = {
  data: matchOption(new SlashCommandBuilder().setName('contestar').setDescription('Contesta o resultado informado pelo adversário')),
  execute: (i) => handleDispute(i, i.options.getInteger('partida')),
};

export const partidas: Command = {
  data: new SlashCommandBuilder().setName('partidas').setDescription('Lista suas partidas em aberto'),
  async execute(interaction) {
    const open = await listOpenMatches(interaction.user.id);
    const lines = await Promise.all(open.map(async (m) => `\`#${m.id}\` ${m.game} — ${await versus(m)} · ${STATUS_LABEL[m.status]}`));
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.info)
          .setTitle('📋 Suas partidas em aberto')
          .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '_Nenhuma partida em aberto._'),
      ],
    });
  },
};
