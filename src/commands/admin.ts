import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { afterMatchConfirmed, announceSeasonEnd, resultEmbed, updateScoreboard } from '../bot/announcer.js';
import { type ChannelKey, setChannel } from '../bot/channels.js';
import { Colors, discordTime, mention } from '../bot/format.js';
import { openWeeklyEvent } from '../bot/weeklyEvent.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { UserError } from '../lib/types.js';
import { addCoins } from '../services/economy.js';
import { addGame, listGames, removeGame } from '../services/games.js';
import { adminSetResult, cancelDuel } from '../services/matches.js';
import { ensurePlayer } from '../services/players.js';
import { endActiveSeason, getActiveSeason } from '../services/seasons.js';
import { type Command, refOf } from './types.js';

const CHANNEL_TOPICS: Record<ChannelKey, string> = {
  commands: 'Todos os comandos do bot',
  scoreboard: 'Ranking atualizado automaticamente',
  matches: 'Histórico das disputas',
  events: 'Inscrição para campeonatos',
};

export const setup: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Cria/configura os canais #comandos, #placar, #partidas e #eventos')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => o.setName('categoria').setDescription('Categoria onde criar os canais').addChannelTypes(ChannelType.GuildCategory)),
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) throw new UserError('Use este comando dentro do servidor.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const category = interaction.options.getChannel('categoria');
    const everyone = guild.roles.everyone.id;
    const me = guild.members.me!.id;

    const lines: string[] = [];
    for (const key of Object.keys(config.channels) as ChannelKey[]) {
      const name = config.channels[key];
      let channel = guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildText);
      if (!channel) {
        channel = await guild.channels.create({
          name,
          type: ChannelType.GuildText,
          topic: CHANNEL_TOPICS[key],
          parent: category?.id,
          // #placar é só leitura para os membros.
          permissionOverwrites:
            key === 'scoreboard'
              ? [
                  { id: everyone, deny: [PermissionFlagsBits.SendMessages] },
                  { id: me, allow: [PermissionFlagsBits.SendMessages] },
                ]
              : undefined,
        });
        lines.push(`✨ criado ${channel}`);
      } else {
        lines.push(`✅ encontrado ${channel}`);
      }
      await setChannel(key, channel.id);
    }
    await updateScoreboard(interaction.client);
    await interaction.editReply(`Canais configurados:\n${lines.join('\n')}`);
  },
};

export const temporada: Command = {
  data: new SlashCommandBuilder()
    .setName('temporada')
    .setDescription('Informações e controle da temporada')
    .addSubcommand((s) => s.setName('info').setDescription('Mostra a temporada atual'))
    .addSubcommand((s) => s.setName('encerrar').setDescription('(Admin) Encerra a temporada agora e inicia a próxima')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'info') {
      const season = await getActiveSeason();
      const past = await prisma.season.findMany({ where: { active: false }, orderBy: { number: 'desc' }, take: 5 });
      const embed = new EmbedBuilder()
        .setColor(Colors.primary)
        .setTitle(`📅 Temporada ${String(season.number).padStart(2, '0')}`)
        .setDescription(
          `Começou ${discordTime(season.startedAt, 'D')} · termina ${discordTime(season.endsAt)}\n` +
            `Ranking por **${config.rankingMode === 'elo' ? 'ELO' : 'pontos'}** (vitória +${config.points.win}, derrota +${config.points.loss})`,
        );
      if (past.length) {
        embed.addFields({
          name: 'Campeões anteriores',
          value: past.map((s) => `T${String(s.number).padStart(2, '0')}: ${s.championId ? mention(s.championId) : '—'}`).join('\n'),
        });
      }
      await interaction.reply({ embeds: [embed] });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError('Apenas admins.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await endActiveSeason();
    await announceSeasonEnd(interaction.client, result);
    await interaction.editReply(`Temporada ${result.endedNumber} encerrada. Temporada ${result.newSeasonNumber} iniciada.`);
  },
};

export const jogo: Command = {
  data: new SlashCommandBuilder()
    .setName('jogo')
    .setDescription('Jogos disponíveis para disputas')
    .addSubcommand((s) => s.setName('listar').setDescription('Lista os jogos'))
    .addSubcommand((s) =>
      s
        .setName('adicionar')
        .setDescription('(Admin) Adiciona um jogo')
        .addStringOption((o) => o.setName('nome').setDescription('Nome do jogo').setRequired(true).setMaxLength(50)),
    )
    .addSubcommand((s) =>
      s
        .setName('remover')
        .setDescription('(Admin) Remove um jogo')
        .addStringOption((o) => o.setName('nome').setDescription('Nome do jogo').setRequired(true).setAutocomplete(true)),
    ),
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const games = await listGames();
    await interaction.respond(games.filter((g) => g.name.toLowerCase().includes(typed)).slice(0, 25).map((g) => ({ name: g.name, value: g.name })));
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'listar') {
      const games = await listGames();
      await interaction.reply(`🎮 Jogos: ${games.map((g) => `**${g.name}**`).join(' · ')}`);
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError('Apenas admins.');
    const name = interaction.options.getString('nome', true);
    if (sub === 'adicionar') {
      const g = await addGame(name);
      await interaction.reply(`✅ Jogo **${g.name}** adicionado.`);
    } else {
      await removeGame(name);
      await interaction.reply(`🗑️ Jogo **${name}** removido.`);
    }
  },
};

export const admin: Command = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Ferramentas de moderação do Fluxer')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('resultado')
        .setDescription('Define o resultado de uma partida (ex.: disputas)')
        .addIntegerOption((o) => o.setName('partida').setDescription('ID da partida').setRequired(true).setMinValue(1))
        .addUserOption((o) => o.setName('vencedor').setDescription('Vencedor').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('cancelar')
        .setDescription('Cancela uma partida não confirmada')
        .addIntegerOption((o) => o.setName('partida').setDescription('ID da partida').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('moedas')
        .setDescription('Dá ou remove FluxCoins')
        .addUserOption((o) => o.setName('jogador').setDescription('Jogador').setRequired(true))
        .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantidade (negativo para remover)').setRequired(true))
        .addStringOption((o) => o.setName('motivo').setDescription('Motivo')),
    )
    .addSubcommand((s) => s.setName('placar').setDescription('Recria/atualiza a mensagem do #placar'))
    .addSubcommand((s) => s.setName('evento-semanal').setDescription('Abre o evento semanal agora')),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError('Apenas admins.');
    const sub = interaction.options.getSubcommand();

    if (sub === 'resultado') {
      const result = await adminSetResult(interaction.options.getInteger('partida', true), interaction.options.getUser('vencedor', true).id);
      await interaction.reply({ content: `🛡️ Resultado definido por ${mention(interaction.user.id)}.`, embeds: [await resultEmbed(result)] });
      await afterMatchConfirmed(interaction.client, result);
      return;
    }
    if (sub === 'cancelar') {
      const match = await cancelDuel(interaction.user.id, interaction.options.getInteger('partida', true), true);
      await interaction.reply(`🚫 Partida #${match.id} cancelada.`);
      return;
    }
    if (sub === 'moedas') {
      const user = interaction.options.getUser('jogador', true);
      const amount = interaction.options.getInteger('quantidade', true);
      await ensurePlayer(prisma, refOf(user));
      const balance = await addCoins(prisma, user.id, amount, interaction.options.getString('motivo') ?? `Ajuste por ${interaction.user.username}`);
      await interaction.reply(`🪙 ${mention(user.id)}: ${amount >= 0 ? '+' : ''}${amount} FluxCoins (saldo ${balance}).`);
      return;
    }
    if (sub === 'placar') {
      await updateScoreboard(interaction.client);
      await interaction.reply({ content: '✅ Placar atualizado.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === 'evento-semanal') {
      await openWeeklyEvent(interaction.client, interaction.user.id);
      await interaction.reply({ content: '✅ Evento semanal aberto em #eventos.', flags: MessageFlags.Ephemeral });
    }
  },
};
