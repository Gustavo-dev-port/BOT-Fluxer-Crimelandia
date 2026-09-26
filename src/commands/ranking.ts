import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { scoreboardEmbed } from '../bot/announcer.js';
import { Colors, discordTime, medal, mention, signed } from '../bot/format.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { relativeDay } from '../lib/rivalry.js';
import { tierFor } from '../lib/tiers.js';
import { UserError } from '../lib/types.js';
import { getProfile, getRivalries } from '../services/profile.js';
import { getRanking, type RankingMode, rankingValue } from '../services/ranking.js';
import { getActiveSeason } from '../services/seasons.js';
import type { Command } from './types.js';

const pad = (n: number) => String(n).padStart(2, '0');

export const rank: Command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o ranking da temporada')
    .addIntegerOption((o) => o.setName('temporada').setDescription('Número de uma temporada anterior').setMinValue(1))
    .addStringOption((o) =>
      o.setName('modo').setDescription('Ordenar por pontos ou ELO').addChoices({ name: 'Pontos', value: 'pontos' }, { name: 'ELO', value: 'elo' }),
    ),
  async execute(interaction) {
    const number = interaction.options.getInteger('temporada');
    const mode = (interaction.options.getString('modo') ?? config.rankingMode) as RankingMode;
    const season = number ? await prisma.season.findUnique({ where: { number } }) : await getActiveSeason();
    if (!season) throw new UserError(`Temporada ${number} não encontrada.`);

    const ranking = await getRanking(prisma, season.id, { limit: 25, mode });
    const lines = ranking.map((r) => {
      const tier = tierFor(r.rating);
      return `${medal(r.position)} ${mention(r.playerId)} — **${rankingValue(r, mode)}** · ${tier.emoji} ${tier.label} · ${r.wins}V/${r.losses}D`;
    });
    const status = season.active
      ? `Termina ${discordTime(season.endsAt)}`
      : `Encerrada${season.championId ? ` · 👑 Campeão: ${mention(season.championId)}` : ''}`;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.gold)
          .setTitle(`🏆 Ranking — Temporada ${pad(season.number)}`)
          .setDescription(`${status}\n\n${lines.length ? lines.join('\n') : '_Sem partidas nesta temporada._'}`),
      ],
    });
  },
};

export const top10: Command = {
  data: new SlashCommandBuilder().setName('top10').setDescription('Os 10 melhores jogadores da temporada'),
  async execute(interaction) {
    await interaction.reply({ embeds: [await scoreboardEmbed(10)] });
  },
};

export const perfil: Command = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Estatísticas de um jogador')
    .addUserOption((o) => o.setName('jogador').setDescription('Jogador (padrão: você)')),
  async execute(interaction) {
    const user = interaction.options.getUser('jogador') ?? interaction.user;
    const profile = await getProfile(user.id);
    if (!profile) throw new UserError(`${mention(user.id)} ainda não jogou nenhuma partida.`);
    const { player, stats, position, season } = profile;
    const tier = tierFor(stats.rating);

    const header = [
      player.equippedTitle ? `🎖️ *${player.equippedTitle}*` : null,
      `${tier.emoji} **${tier.label}** · ${stats.rating} ELO`,
      position ? `${medal(position)} ${position}º lugar da Temporada ${pad(season.number)}` : '_Sem colocação nesta temporada_',
    ]
      .filter(Boolean)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setAuthor({ name: player.username, iconURL: user.displayAvatarURL() })
      .setDescription(header)
      .addFields(
        { name: 'Vitórias', value: `**${stats.wins}**${profile.winsThisWeek ? ` (${signed(profile.winsThisWeek)} na semana)` : ''}`, inline: true },
        { name: 'Derrotas', value: `**${stats.losses}**`, inline: true },
        { name: 'Win rate', value: `**${profile.winRate}%**`, inline: true },
        { name: 'Sequência', value: `**${stats.streak}** vitórias${stats.bestStreak ? ` (recorde ${stats.bestStreak})` : ''}`, inline: true },
        { name: 'Pontos', value: `**${stats.points}**`, inline: true },
        { name: 'FluxCoins', value: `🪙 **${player.coins}**`, inline: true },
        { name: 'Jogos favoritos', value: profile.favoriteGames.length ? profile.favoriteGames.join(' · ') : '—' },
        {
          name: 'Carreira',
          value: `${profile.career.matches} partidas · ${profile.career.wins} vitórias · 🏆 ${profile.career.tournamentTitles} campeonatos · 👑 ${profile.career.seasonTitles} temporadas`,
        },
      );
    if (profile.achievements.length) {
      embed.addFields({ name: 'Conquistas', value: profile.achievements.map((a) => `${a.emoji} ${a.name}`).join(' · ') });
    }
    await interaction.reply({ embeds: [embed] });
  },
};

export const rival: Command = {
  data: new SlashCommandBuilder()
    .setName('rival')
    .setDescription('Mostra sua maior rivalidade (ou o confronto direto com alguém)')
    .addUserOption((o) => o.setName('contra').setDescription('Ver confronto direto com este jogador'))
    .addUserOption((o) => o.setName('jogador').setDescription('Ver rivalidades de outro jogador (padrão: você)')),
  async execute(interaction) {
    const me = interaction.options.getUser('jogador') ?? interaction.user;
    const against = interaction.options.getUser('contra');
    const rivalries = await getRivalries(me.id);
    const r = against ? rivalries.find((x) => x.opponentId === against.id) : rivalries[0];

    if (!r) {
      throw new UserError(
        against ? `${mention(me.id)} e ${mention(against.id)} ainda não se enfrentaram.` : `${mention(me.id)} ainda não tem duelos 1v1 confirmados.`,
      );
    }
    const title = against ? 'Confronto direto ⚔️' : 'Maior rivalidade ⚔️';
    const leader = r.wins === r.losses ? 'Empate técnico! 🤝' : r.wins > r.losses ? `${mention(me.id)} lidera` : `${mention(r.opponentId)} lidera`;
    const others = against
      ? ''
      : rivalries
          .slice(1, 4)
          .map((x) => `${mention(x.opponentId)} — ${x.total} partidas (${x.wins}×${x.losses})`)
          .join('\n');

    const embed = new EmbedBuilder()
      .setColor(Colors.danger)
      .setTitle(title)
      .setDescription(
        `${against ? '' : `${me.id === interaction.user.id ? 'Sua maior rivalidade' : `A maior rivalidade de ${mention(me.id)}`} é com ${mention(r.opponentId)}\n\n`}` +
          `**${r.total}** partidas\n` +
          `${mention(me.id)}: **${r.wins}** vitórias\n` +
          `${mention(r.opponentId)}: **${r.losses}** vitórias\n` +
          `${leader}\n\n` +
          `Último confronto: ${relativeDay(r.lastPlayedAt)}`,
      );
    if (others) embed.addFields({ name: 'Outras rivalidades', value: others });
    await interaction.reply({ embeds: [embed] });
  },
};
