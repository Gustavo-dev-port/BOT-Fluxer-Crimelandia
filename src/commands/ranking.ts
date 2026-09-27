import { scoreboardEmbed } from '../embeds/matchEmbeds.js';
import { Colors, formatDuration, medal, mention, progressBar, signed, timeTag } from '../embeds/format.js';
import { config } from '../config.js';
import { prisma } from '../database/client.js';
import type { Embed } from '../fluxer/types.js';
import { relativeDay } from '../services/rules/rivalry.js';
import { tierFor, tierProgress } from '../services/rules/tiers.js';
import { honorStatus, playerClass } from '../services/rules/honors.js';
import { UserError } from '../types/domain.js';
import { getCommunityRivalries, getProfile, getRivalries } from '../services/profile.js';
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
  description: 'Perfil medieval: classe, liga, títulos, conquistas e estatísticas',
  async execute(ctx) {
    const user = (await ctx.mentionedUsers())[0] ?? ctx.author;
    const profile = await getProfile(user.id);
    if (!profile) throw new UserError(`${mention(user.id)} ainda não jogou nenhuma partida.`);
    const { player, stats, position, season, honors } = profile;
    const tier = tierFor(stats.rating);
    const progress = tierProgress(stats.rating);
    const klass = playerClass(honors);
    const titles = honorStatus(honors);

    const league = progress.next
      ? `${progressBar(progress.percent, 100)} faltam **${progress.remaining}** para ${progress.next}`
      : `${progressBar(1, 1)} topo do reino`;
    const header = [
      '━━━━━━━━ ⚜️ ━━━━━━━━',
      player.equippedTitle ? `🎖️ *${player.equippedTitle}*` : null,
      `${klass.emoji} **${klass.name}** — _${klass.description}_`,
      `${tier.emoji} **${tier.label}** · ${stats.rating} ELO`,
      league,
      position ? `${medal(position)} ${position}º lugar da Temporada ${pad(season.number)}` : '_Sem colocação nesta temporada_',
    ]
      .filter(Boolean)
      .join('\n');

    const embed: Embed = {
      color: Colors.royalGold,
      title: `⚔️ ${player.username}`,
      description: header,
      fields: [
        {
          name: 'Vitórias',
          value: `**${stats.wins}**${profile.winsThisWeek ? ` (${signed(profile.winsThisWeek)} na semana)` : ''}`,
          inline: true,
        },
        { name: 'Derrotas', value: `**${stats.losses}**`, inline: true },
        { name: 'Win rate', value: `**${profile.winRate}%**\n${progressBar(profile.winRate, 100)}`, inline: true },
        {
          name: 'Sequência',
          value: `**${stats.streak}** vitórias${stats.bestStreak ? ` (recorde ${stats.bestStreak})` : ''}`,
          inline: true,
        },
        { name: 'Pontos', value: `**${stats.points}**`, inline: true },
        { name: 'FluxCoins', value: `🪙 **${player.coins}**`, inline: true },
        {
          name: 'Títulos',
          value: titles
            .map((t) =>
              t.earned
                ? `${t.title.emoji} **${t.title.name}**`
                : `🔒 ${t.title.name} — ${progressBar(t.current, t.target, 8)} ${t.current}/${t.target} · _${t.title.requirement}_`,
            )
            .join('\n'),
        },
        { name: 'Jogos favoritos', value: profile.favoriteGames.length ? profile.favoriteGames.join(' · ') : '—' },
        {
          name: 'Carreira',
          value:
            `${profile.career.matches} partidas · ${profile.career.wins} vitórias · 🏆 ${profile.career.tournamentTitles} campeonatos · 👑 ${profile.career.seasonTitles} temporadas` +
            (profile.career.avgDurationSeconds ? ` · ⏱️ ${formatDuration(profile.career.avgDurationSeconds)} por partida` : ''),
        },
      ],
    };
    const avatar = ctx.client.avatarUrl(user);
    if (avatar) embed.thumbnail = { url: avatar };
    if (profile.achievements.length) {
      embed.fields!.push({ name: 'Conquistas', value: profile.achievements.map((a) => `${a.emoji} ${a.name}`).join(' · ') });
    }
    await ctx.reply({ ...quiet, embeds: [embed] });
  },
};

const winRateOf = (wins: number, total: number) => (total ? Math.round((wins / total) * 100) : 0);

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
      color: Colors.wine,
      title: against ? 'Confronto direto ⚔️' : 'Maior rivalidade ⚔️',
      description:
        intro +
        `**${r.total}** partidas\n` +
        `${mention(me.id)}: **${r.wins}** vitórias (${winRateOf(r.wins, r.total)}%)\n` +
        `${mention(r.opponentId)}: **${r.losses}** vitórias (${winRateOf(r.losses, r.total)}%)\n` +
        `${leader}\n\n` +
        `Último confronto: ${relativeDay(r.lastPlayedAt)}`,
      fields: [
        {
          name: 'Histórico',
          value: r.history
            .map((h) => `${h.won ? '✅' : '❌'} ${h.won ? mention(me.id) : mention(r.opponentId)} venceu · ${relativeDay(h.playedAt)}`)
            .join('\n'),
        },
      ],
    };
    const others = against
      ? ''
      : rivalries
          .slice(1, 4)
          .map((x) => `${mention(x.opponentId)} — ${x.total} partidas (${x.wins}×${x.losses})`)
          .join('\n');
    if (others) embed.fields!.push({ name: 'Outras rivalidades', value: others });
    await ctx.reply({ ...quiet, embeds: [embed] });
  },
};

export const rivalidades: Command = {
  name: 'rivalidades',
  aliases: ['rivais', 'top-rivalidades'],
  category: 'Ranking',
  usage: '',
  description: 'As 10 maiores rivalidades da comunidade',
  details: ['Conta os duelos 1v1 confirmados de todas as temporadas; cada par precisa de ao menos 2 duelos.'],
  async execute(ctx) {
    const top = await getCommunityRivalries(10);
    const lines = top.map(
      (p, i) =>
        `${medal(i + 1)} ${mention(p.playerA)} **${p.winsA}** × **${p.winsB}** ${mention(p.playerB)} — ${p.total} duelos · último ${relativeDay(p.lastPlayedAt)}`,
    );
    await ctx.reply({
      ...quiet,
      embeds: [
        {
          color: Colors.wine,
          title: '⚔️ Rivalidades do Reino',
          description: lines.length ? lines.join('\n') : '_Nenhuma rivalidade ainda: são precisos 2 duelos entre os mesmos jogadores._',
        },
      ],
    });
  },
};
