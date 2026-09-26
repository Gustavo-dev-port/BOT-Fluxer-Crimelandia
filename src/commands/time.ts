import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { challengeButtons, challengeEmbed } from '../bot/announcer.js';
import { Colors, mention } from '../bot/format.js';
import { UserError } from '../lib/types.js';
import { resolveGame } from '../services/games.js';
import { createTeamChallenge } from '../services/matches.js';
import { createTeam, disbandTeam, getTeamByName, leaveTeam, listTeams } from '../services/teams.js';
import { autocompleteGame, type Command, isAdmin, refOf } from './types.js';

const MEMBER_OPTIONS = 9;

const builder = new SlashCommandBuilder()
  .setName('time')
  .setDescription('Times para partidas 2v2, 3v3 ou squads')
  .addSubcommand((s) => {
    s.setName('criar')
      .setDescription('Cria um time (você é o capitão)')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do time').setRequired(true).setMaxLength(32))
      .addUserOption((o) => o.setName('membro1').setDescription('Membro').setRequired(true));
    for (let i = 2; i <= MEMBER_OPTIONS; i++) s.addUserOption((o) => o.setName(`membro${i}`).setDescription('Membro'));
    return s;
  })
  .addSubcommand((s) =>
    s
      .setName('info')
      .setDescription('Mostra um time')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do time').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('listar')
      .setDescription('Lista os times')
      .addUserOption((o) => o.setName('jogador').setDescription('Só os times deste jogador')),
  )
  .addSubcommand((s) =>
    s
      .setName('sair')
      .setDescription('Sai de um time')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do time').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('desfazer')
      .setDescription('Desfaz o time (só o capitão)')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do time').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('desafiar')
      .setDescription('Desafia outro time')
      .addStringOption((o) => o.setName('meu_time').setDescription('Seu time').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('adversario').setDescription('Time adversário').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('jogo').setDescription('Jogo da disputa').setRequired(true).setAutocomplete(true)),
  );

export const time: Command = {
  data: builder,
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'jogo') return autocompleteGame(interaction);
    const mine = focused.name === 'meu_time' || ['sair', 'desfazer'].includes(interaction.options.getSubcommand());
    const teams = await listTeams(mine ? interaction.user.id : undefined);
    await interaction.respond(
      teams
        .filter((t) => t.name.toLowerCase().includes(String(focused.value).toLowerCase()))
        .slice(0, 25)
        .map((t) => ({ name: `${t.name} (${t.members.length})`, value: t.name })),
    );
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      const members = [];
      for (let i = 1; i <= MEMBER_OPTIONS; i++) {
        const u = interaction.options.getUser(`membro${i}`);
        if (u?.bot) throw new UserError('Bots não podem entrar em times.');
        if (u) members.push(refOf(u));
      }
      const team = await createTeam(interaction.options.getString('nome', true), refOf(interaction.user), members);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.success)
            .setTitle(`🛡️ Time ${team.name} criado`)
            .setDescription(`Capitão: ${mention(team.captainId)}\nMembros: ${team.members.map((m) => mention(m.playerId)).join(', ')}`),
        ],
      });
      return;
    }

    if (sub === 'info') {
      const team = await getTeamByName(interaction.options.getString('nome', true));
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.info)
            .setTitle(`🛡️ ${team.name}`)
            .setDescription(
              team.members.map((m) => `${m.playerId === team.captainId ? '👑' : '•'} ${mention(m.playerId)}`).join('\n'),
            )
            .setFooter({ text: `${team.members.length} jogadores` }),
        ],
      });
      return;
    }

    if (sub === 'listar') {
      const user = interaction.options.getUser('jogador');
      const teams = await listTeams(user?.id);
      const lines = teams.map((t) => `**${t.name}** — ${t.members.length} jogadores · capitão ${mention(t.captainId)}`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.info)
            .setTitle('🛡️ Times')
            .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '_Nenhum time criado._'),
        ],
      });
      return;
    }

    if (sub === 'sair') {
      const name = interaction.options.getString('nome', true);
      const res = await leaveTeam(name, interaction.user.id);
      const extra = res.disbanded ? ' O time ficou vazio e foi desfeito.' : res.newCaptainId ? ` Novo capitão: ${mention(res.newCaptainId)}.` : '';
      await interaction.reply(`👋 ${mention(interaction.user.id)} saiu de **${name}**.${extra}`);
      return;
    }

    if (sub === 'desfazer') {
      const team = await disbandTeam(interaction.options.getString('nome', true), interaction.user.id, isAdmin(interaction));
      await interaction.reply(`🗑️ Time **${team.name}** desfeito.`);
      return;
    }

    if (sub === 'desafiar') {
      const [mine, other] = await Promise.all([
        getTeamByName(interaction.options.getString('meu_time', true)),
        getTeamByName(interaction.options.getString('adversario', true)),
      ]);
      const game = await resolveGame(interaction.options.getString('jogo', true));
      const { match, team2 } = await createTeamChallenge(interaction.user.id, mine.id, other.id, game);
      await interaction.reply({
        content: `${mention(team2.captainId)} (capitão de **${team2.name}**)`,
        embeds: [await challengeEmbed(match)],
        components: [challengeButtons(match.id)],
      });
    }
  },
};
