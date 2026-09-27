import { scoreboardEmbed } from '../bot/announcer.js';
import { Colors, formatDuration, medal, mention, signed, timeTag } from '../bot/format.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { Embed } from '../fluxer/types.js';
import { relativeDay } from '../lib/rivalry.js';
import { tierFor } from '../lib/tiers.js';
import { UserError } from '../lib/types.js';
import { getProfile, getRivalries } from '../services/profile.js';
import { getRanking, type RankingMode, rankingValue } from '../services/ranking.js';
import { getActiveSeason } from '../services/seasons.js';
import type { Command } from './types.js';

const pad = (n: number) => String(n).padStart(2, '0');
const quiet = { allowed_mentions: { parse: [] as never[] } };

export const rank: Command = {
  name: 'rank',
  aliases: ['ranking'],
  category: 'Ranking',
  usage: '[temporada] [pontos|elo]',
  description: 'Ranking da temporada atual ou de uma anterior',
  details: ['Ex.: `!rank` · `!rank elo` · `!rank 2` (Temporada 02 arquivada)'],
  async execute(ctx) {
    const lower = ctx.args.map((a) => a.toLowerCase());
    const mode = (lower.find((a) => a === 'elo' || a === 'pontos') ?? config.rankingMode) as RankingMode;
    const number = ctx.smallId();
    const season = number ? await prisma.season.findUnique({ where: { number } }) : await getActiveSeason();
    if (!season) throw new UserError(`Temporada ${number} não encontrada.`);

    const ranking = await getRanking(prisma, season.id, { limit: 25, mode });
    const lines = ranking.map((r) => {
      const tier = tierFor(r.rating);
      return `${medal(r.position)} ${mention(r.playerId)} — **${rankingValue(r, mode)}** · ${tier.emoji} ${tier.label} · ${r.wins}V/${r.losses}D`;
    });
    const status = season.active
      ? `Termina ${timeTag(season.endsAt)}`
      : `Encerrada${season.championId ? ` · 👑 Campeão: ${mention(season.championId)}` : ''}`;
    await ctx.reply({
      ...quiet,
      embeds: [
        {
          color: Colors.gold,
          title: `🏆 Ranking — Temporada ${pad(season.number)}`,
          description: `${status}\n\n${lines.length ? lines.join('\n') : '_Sem partidas nesta temporada._'}`,
        },
      ],
    });
  },
};

export const top10: Command = {
  name: 'top10',
  aliases: ['top'],
  category: 'Ranking',
  usage: '',
  description: 'Os 10 melhores jogadores da temporada',
  async execute(ctx) {
    await ctx.reply({ ...quiet, embeds: [await scoreboardEmbed(10)] });
  },
};

export const perfil: Command = {
  name: 'perfil',
  aliases: ['stats', 'p'],
  category: 'Ranking',
  usage: '[@jogador]',
  description: 'Estatísticas de um jogador',
  async execute(ctx) {
    const user = (await ctx.mentionedUsers())[0] ?? ctx.author;
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

    const embed: Embed = {
      color: Colors.primary,
      author: { name: player.username },
      description: header,
      fields: [
        {
          name: 'Vitórias',
          value: `**${stats.wins}**${profile.winsThisWeek ? ` (${signed(profile.winsThisWeek)} na semana)` : ''}`,
          inline: true,
        },
        { name: 'Derrotas', value: `**${stats.losses}**`, inline: true },
        { name: 'Win rate', value: `**${profile.winRate}%**`, inline: true },
        {
          name: 'Sequência',
          value: `**${stats.streak}** vitórias${stats.bestStreak ? ` (recorde ${stats.bestStreak})` : ''}`,
          inline: true,
        },
        { name: 'Pontos', value: `**${stats.points}**`, inline: true },
        { name: 'FluxCoins', value: `🪙 **${player.coins}**`, inline: true },
        { name: 'Jogos favoritos', value: profile.favoriteGames.length ? profile.favoriteGames.join(' · ') : '—' },
        {
          name: 'Carreira',
          value:
            `${profile.career.matches} partidas · ${profile.career.wins} vitórias · 🏆 ${profile.career.tournamentTitles} campeonatos · 👑 ${profile.career.seasonTitles} temporadas` +
            (profile.career.avgDurationSeconds ? ` · ⏱️ ${formatDuration(profile.career.avgDurationSeconds)} por partida` : ''),
        },
      ],
    };
    if (profile.achievements.length) {
      embed.fields!.push({ name: 'Conquistas', value: profile.achievements.map((a) => `${a.emoji} ${a.name}`).join(' · ') });
    }
    await ctx.reply({ ...quiet, embeds: [embed] });
  },
};

export const rival: Command = {
  name: 'rival',
  aliases: ['rivalidade', 'h2h'],
  category: 'Ranking',
  usage: '[@jogador] [@outro]',
  description: 'Sua maior rivalidade, ou o confronto direto com alguém',
  details: ['`!rival` → sua maior rivalidade', '`!rival @Lucas` → você contra Lucas', '`!rival @Lucas @João` → Lucas contra João'],
  async execute(ctx) {
    const mentioned = await ctx.mentionedUsers();
    const [me, against] = mentioned.length >= 2 ? [mentioned[0], mentioned[1]] : [ctx.author, mentioned[0]];
    const rivalries = await getRivalries(me.id);
    const r = against ? rivalries.find((x) => x.opponentId === against.id) : rivalries[0];

    if (!r) {
      throw new UserError(
        against
          ? `${mention(me.id)} e ${mention(against.id)} ainda não se enfrentaram.`
          : `${mention(me.id)} ainda não tem duelos 1v1 confirmados.`,
      );
    }
    const leader =
      r.wins === r.losses ? 'Empate técnico! 🤝' : r.wins > r.losses ? `${mention(me.id)} lidera` : `${mention(r.opponentId)} lidera`;
    const intro = against
      ? ''
      : `${me.id === ctx.author.id ? 'Sua maior rivalidade' : `A maior rivalidade de ${mention(me.id)}`} é com ${mention(r.opponentId)}\n\n`;

    const embed: Embed = {
      color: Colors.danger,
      title: against ? 'Confronto direto ⚔️' : 'Maior rivalidade ⚔️',
      description:
        intro +
        `**${r.total}** partidas\n` +
        `${mention(me.id)}: **${r.wins}** vitórias\n` +
        `${mention(r.opponentId)}: **${r.losses}** vitórias\n` +
        `${leader}\n\n` +
        `Último confronto: ${relativeDay(r.lastPlayedAt)}`,
    };
    const others = against
      ? ''
      : rivalries
          .slice(1, 4)
          .map((x) => `${mention(x.opponentId)} — ${x.total} partidas (${x.wins}×${x.losses})`)
          .join('\n');
    if (others) embed.fields = [{ name: 'Outras rivalidades', value: others }];
    await ctx.reply({ ...quiet, embeds: [embed] });
  },
};
