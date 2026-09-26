import { type AutocompleteInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { announceTournamentProgress } from '../bot/announcer.js';
import { Colors } from '../bot/format.js';
import { announceTournament, FORMAT_LABEL, refreshTournamentMessage, tournamentEmbed } from '../bot/tournamentView.js';
import { prisma } from '../db.js';
import { TournamentFormat, TournamentStatus, UserError } from '../lib/types.js';
import { resolveGame } from '../services/games.js';
import { consumeEventCredit } from '../services/shop.js';
import { listTeams } from '../services/teams.js';
import {
  cancelTournament,
  createTournament,
  getTournament,
  listTournaments,
  register,
  startTournament,
  unregister,
} from '../services/tournaments.js';
import { autocompleteGame, type Command, isAdmin, refOf } from './types.js';

async function autocompleteTournament(interaction: AutocompleteInteraction, statuses?: string[]) {
  const typed = String(interaction.options.getFocused()).toLowerCase();
  const list = await listTournaments(statuses);
  await interaction.respond(
    list
      .filter((t) => t.name.toLowerCase().includes(typed) || String(t.id).startsWith(typed))
      .slice(0, 25)
      .map((t) => ({ name: `#${t.id} ${t.name} (${t._count.entries} inscritos)`, value: t.id })),
  );
}

const idOption = (desc = 'Campeonato') => (o: import('discord.js').SlashCommandIntegerOption) =>
  o.setName('id').setDescription(desc).setRequired(true).setAutocomplete(true);

export const campeonato: Command = {
  data: new SlashCommandBuilder()
    .setName('campeonato')
    .setDescription('Campeonatos: chave simples ou todos contra todos')
    .addSubcommand((s) =>
      s
        .setName('criar')
        .setDescription('Cria um campeonato (admins, ou com crédito de evento da loja)')
        .addStringOption((o) => o.setName('nome').setDescription('Nome do campeonato').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('jogo').setDescription('Jogo').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName('formato')
            .setDescription('Formato')
            .setRequired(true)
            .addChoices(
              { name: FORMAT_LABEL.SINGLE_ELIM, value: TournamentFormat.SINGLE_ELIM },
              { name: FORMAT_LABEL.ROUND_ROBIN, value: TournamentFormat.ROUND_ROBIN },
            ),
        )
        .addIntegerOption((o) => o.setName('tamanho_time').setDescription('Jogadores por time (1 = individual)').setMinValue(1).setMaxValue(10)),
    )
    .addSubcommand((s) => s.setName('iniciar').setDescription('Fecha inscrições e gera a chave').addIntegerOption(idOption()))
    .addSubcommand((s) => s.setName('chave').setDescription('Mostra a chave / classificação').addIntegerOption(idOption()))
    .addSubcommand((s) => s.setName('listar').setDescription('Lista campeonatos abertos e em andamento'))
    .addSubcommand((s) => s.setName('sair').setDescription('Cancela sua inscrição').addIntegerOption(idOption()))
    .addSubcommand((s) => s.setName('cancelar').setDescription('Cancela o campeonato').addIntegerOption(idOption())),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'jogo') return autocompleteGame(interaction);
    const sub = interaction.options.getSubcommand();
    const statuses = sub === 'chave' ? [TournamentStatus.REGISTRATION, TournamentStatus.RUNNING, TournamentStatus.FINISHED] : undefined;
    await autocompleteTournament(interaction, statuses);
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      const admin = isAdmin(interaction);
      const game = await resolveGame(interaction.options.getString('jogo', true));
      if (!admin && !(await consumeEventCredit(interaction.user.id))) {
        throw new UserError('Só admins podem criar campeonatos. Compre um **evento personalizado** na /loja para criar o seu!');
      }
      const t = await createTournament({
        name: interaction.options.getString('nome', true),
        game,
        format: interaction.options.getString('formato', true) as TournamentFormat,
        teamSize: interaction.options.getInteger('tamanho_time') ?? 1,
        createdById: interaction.user.id,
      });
      await announceTournament(interaction.client, t.id, '📢 Novo campeonato! Inscreva-se com **/inscrever** ou pelo botão.');
      await interaction.reply({ content: `✅ Campeonato **${t.name}** (#${t.id}) criado e anunciado em #eventos.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'listar') {
      const list = await listTournaments();
      const lines = list.map(
        (t) => `\`#${t.id}\` **${t.name}** — ${t.game} · ${FORMAT_LABEL[t.format]} · ${t._count.entries} inscritos · ${t.status === 'RUNNING' ? '🎮 em andamento' : '📝 inscrições abertas'}`,
      );
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(Colors.info).setTitle('🏆 Campeonatos').setDescription(lines.join('\n') || '_Nenhum campeonato aberto._')],
      });
      return;
    }

    const id = interaction.options.getInteger('id', true);

    if (sub === 'chave') {
      await interaction.reply({ embeds: [await tournamentEmbed(id)] });
      return;
    }

    if (sub === 'sair') {
      await unregister(id, interaction.user.id);
      await refreshTournamentMessage(interaction.client, id);
      await interaction.reply({ content: '👋 Inscrição cancelada.', flags: MessageFlags.Ephemeral });
      return;
    }

    const t = await getTournament(prisma, id);
    if (!isAdmin(interaction) && t.createdById !== interaction.user.id) {
      throw new UserError('Só o criador do campeonato ou um admin pode fazer isso.');
    }

    if (sub === 'iniciar') {
      await interaction.deferReply();
      const progress = await startTournament(id);
      await refreshTournamentMessage(interaction.client, id);
      await interaction.editReply({ content: `🚀 **${t.name}** começou!`, embeds: [await tournamentEmbed(id)] });
      await announceTournamentProgress(interaction.client, progress);
      return;
    }

    if (sub === 'cancelar') {
      await cancelTournament(id);
      await refreshTournamentMessage(interaction.client, id);
      await interaction.reply(`🚫 Campeonato **${t.name}** cancelado.`);
    }
  },
};

export const inscrever: Command = {
  data: new SlashCommandBuilder()
    .setName('inscrever')
    .setDescription('Entra em um campeonato')
    .addIntegerOption((o) => o.setName('campeonato').setDescription('Campeonato').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('time').setDescription('Seu time (campeonatos em times)').setAutocomplete(true)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'time') {
      const teams = await listTeams(interaction.user.id);
      await interaction.respond(teams.slice(0, 25).map((t) => ({ name: `${t.name} (${t.members.length})`, value: t.name })));
      return;
    }
    await autocompleteTournament(interaction, [TournamentStatus.REGISTRATION]);
  },
  async execute(interaction) {
    const id = interaction.options.getInteger('campeonato', true);
    const { tournament, label } = await register(id, refOf(interaction.user), interaction.options.getString('time'));
    await refreshTournamentMessage(interaction.client, id);
    await interaction.reply(`📝 ${label} inscrito em **${tournament.name}**!`);
  },
};
