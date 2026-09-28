import { afterMatchConfirmed, announceSeasonEnd, retirePrompts, updateScoreboard } from '../services/notifications/announcer.js';
import { resultEmbed } from '../embeds/matchEmbeds.js';
import { type ChannelKey, normalizeChannelName, setChannel } from '../services/channels.js';
import { guildSettings } from '../database/guildSettingsRepository.js';
import { Colors, mention, timeTag } from '../embeds/format.js';
import { openWeeklyEvent } from '../schedulers/weeklyEvent.js';
import { config } from '../config.js';
import { prisma } from '../database/client.js';
import { Permission } from '../fluxer/permissions.js';
import { ChannelType, type Embed } from '../fluxer/types.js';
import { freeText } from '../utils/args.js';
import { UserError } from '../types/domain.js';
import { addCoins } from '../services/economy.js';
import { addGame, listGames, removeGame } from '../services/games.js';
import { adminSetResult, cancelDuel } from '../services/matches.js';
import { ensurePlayer } from '../services/players.js';
import { endActiveSeason, getActiveSeason } from '../services/seasons.js';
import { type Command, refOf } from './types.js';

/** Canais que o !setup cria. Promoções e jogos grátis entram quando esses módulos existirem. */
const SETUP_CHANNELS: Partial<Record<ChannelKey, string>> = {
  commands: 'Todos os comandos do bot',
  scoreboard: 'Ranking atualizado automaticamente',
  matches: 'Histórico das disputas',
  events: 'Inscrição para campeonatos',
  promo: 'Promoções de jogos com 40%+ de desconto (atualizado a cada 30 min)',
  freeGames: 'Jogos grátis da Epic, Steam e GOG (atualizado a cada hora)',
  hall: 'Hall do Reino: os destaques da comunidade (atualizado a cada 10 min)',
  music: 'Player de música: o que está tocando, fixado e atualizado (!tocar)',
};

/** Nomes com emoji usados ao criar; se o Fluxer recusar, cria com o nome simples. */
const DECORATED_NAMES: Partial<Record<ChannelKey, string>> = {
  promo: '💸┃promocoes',
  freeGames: '🎁┃jogos-gratis',
  events: '📜┃eventos',
  hall: '🏰┃hall-do-reino',
  music: '🎵┃musica',
};

export const CHAMPION_ROLE_NAME = '🏆 Campeão do Reino';

export const setup: Command = {
  name: 'setup',
  category: 'Administração',
  usage: '',
  description:
    'Cria/configura os canais (#comandos, #placar, #partidas, #eventos, #promocoes, #jogos-gratis, #hall-do-reino, #musica) e o cargo de campeão',
  adminOnly: true,
  async execute(ctx) {
    const { client } = ctx;
    const existing = await client.rest.getGuildChannels(client.guildId);
    const botId = client.botId;
    if (!botId) throw new UserError('O bot ainda está conectando. Tente de novo em alguns segundos.');
    const lines: string[] = [];
    for (const [key, topic] of Object.entries(SETUP_CHANNELS) as [ChannelKey, string][]) {
      const name = config.channels[key];
      let channel = existing.find(
        (c) => c.type === ChannelType.GUILD_TEXT && c.name && normalizeChannelName(c.name) === normalizeChannelName(name),
      );
      if (!channel) {
        const create = (channelName: string) =>
          client.rest.createGuildChannel(
            client.guildId,
            {
              name: channelName,
              type: ChannelType.GUILD_TEXT,
              topic,
              // #placar, #hall-do-reino e #musica são só leitura para os membros (o @everyone tem o mesmo ID do servidor).
              permission_overwrites:
                key === 'scoreboard' || key === 'hall' || key === 'music'
                  ? [
                      { id: client.guildId, type: 0, deny: Permission.SEND_MESSAGES.toString() },
                      { id: botId, type: 1, allow: (Permission.SEND_MESSAGES | Permission.PIN_MESSAGES).toString() },
                    ]
                  : undefined,
            },
            'Fluxer BOT setup',
          );
        const decorated = DECORATED_NAMES[key];
        channel = decorated ? await create(decorated).catch(() => create(name)) : await create(name);
        lines.push(`✨ criado <#${channel.id}>`);
      } else {
        lines.push(`✅ encontrado <#${channel.id}>`);
      }
      await setChannel(client, key, channel.id);
    }

    // Cargo automático do campeão da temporada.
    const championRole = await guildSettings.getRole(client.guildId, 'champion');
    if (championRole) {
      lines.push(`✅ cargo de campeão: <@&${championRole}>`);
    } else {
      const role = await client.rest
        .createRole(client.guildId, { name: CHAMPION_ROLE_NAME, color: 0xfacc15, permissions: '0' }, 'Fluxer BOT setup')
        .catch(() => null);
      if (role) {
        await guildSettings.setRole(client.guildId, 'champion', role.id);
        lines.push(`✨ criado o cargo <@&${role.id}>`);
      } else {
        lines.push('⚠️ não consegui criar o cargo de campeão (o bot precisa de **Gerenciar Cargos**)');
      }
    }

    await updateScoreboard(client);
    await ctx.reply({ content: `Configuração concluída:\n${lines.join('\n')}`, allowed_mentions: { parse: [] } });
  },
};

export const temporada: Command = {
  name: 'temporada',
  aliases: ['season'],
  category: 'Administração',
  usage: '[info|encerrar]',
  description: 'Informações da temporada; `encerrar` (admin) fecha agora e inicia a próxima',
  async execute(ctx) {
    if (ctx.args[0]?.toLowerCase() === 'encerrar') {
      await ctx.requireAdmin();
      const result = await endActiveSeason();
      await announceSeasonEnd(ctx.client, result);
      await ctx.reply(`Temporada ${result.endedNumber} encerrada. Temporada ${result.newSeasonNumber} iniciada.`);
      return;
    }
    const season = await getActiveSeason();
    const past = await prisma.season.findMany({ where: { active: false }, orderBy: { number: 'desc' }, take: 5 });
    const embed: Embed = {
      color: Colors.primary,
      title: `📅 Temporada ${String(season.number).padStart(2, '0')}`,
      description:
        `Começou ${timeTag(season.startedAt, 'D')} · termina ${timeTag(season.endsAt)}\n` +
        `Ranking por **${config.rankingMode === 'elo' ? 'ELO' : 'pontos'}** (vitória +${config.points.win}, derrota +${config.points.loss})`,
    };
    if (past.length) {
      embed.fields = [
        {
          name: 'Campeões anteriores',
          value: past.map((s) => `T${String(s.number).padStart(2, '0')}: ${s.championId ? mention(s.championId) : '—'}`).join('\n'),
        },
      ];
    }
    await ctx.reply({ embeds: [embed], allowed_mentions: { parse: [] } });
  },
};

export const jogo: Command = {
  name: 'jogo',
  aliases: ['jogos'],
  category: 'Administração',
  usage: '[listar|adicionar|remover] [nome]',
  description: 'Jogos disponíveis para disputas (adicionar/remover: admin)',
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    if (!sub || sub === 'listar') {
      const games = await listGames();
      await ctx.reply(`🎮 Jogos: ${games.map((g) => `**${g.name}**`).join(' · ')}`);
      return;
    }
    await ctx.requireAdmin();
    const name = ctx.args.slice(1).join(' ').trim();
    if (!name) throw new UserError('Informe o nome do jogo.');
    if (sub === 'adicionar') {
      const g = await addGame(name);
      await ctx.reply(`✅ Jogo **${g.name}** adicionado.`);
    } else if (sub === 'remover') {
      await removeGame(name);
      await ctx.reply(`🗑️ Jogo **${name}** removido.`);
    } else {
      throw new UserError('Use `!jogo listar`, `!jogo adicionar <nome>` ou `!jogo remover <nome>`.');
    }
  },
};

export const admin: Command = {
  name: 'admin',
  category: 'Administração',
  usage: '<resultado|cancelar|moedas|placar|evento-semanal> ...',
  description: 'Ferramentas de moderação',
  adminOnly: true,
  details: [
    '`!admin resultado #partida @vencedor` — resolve disputas',
    '`!admin cancelar #partida` — cancela uma partida não confirmada',
    '`!admin moedas @jogador <quantidade> [motivo]` — negativo para remover',
    '`!admin placar` — recria/atualiza a mensagem do #placar',
    '`!admin evento-semanal` — abre o evento semanal agora',
  ],
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'resultado') {
      const matchId = ctx.requireSmallId('#partida');
      const winner = await ctx.requireUser(0, 'vencedor');
      const result = await adminSetResult(matchId, winner.id);
      await ctx.reply({ content: `🛡️ Resultado definido por ${mention(ctx.author.id)}.`, embeds: [await resultEmbed(result)] });
      await afterMatchConfirmed(ctx.client, result);
      return;
    }
    if (sub === 'cancelar') {
      const match = await cancelDuel(ctx.author.id, ctx.requireSmallId('#partida'), true);
      await retirePrompts(ctx.client, match.id);
      await ctx.reply(`🚫 Partida #${match.id} cancelada.`);
      return;
    }
    if (sub === 'moedas') {
      const user = await ctx.requireUser(0, 'jogador');
      // A quantidade é o primeiro número inteiro (pode ser negativo) depois da menção.
      const amountToken = ctx.args.slice(1).find((a) => /^-?\d+$/.test(a));
      if (!amountToken) throw new UserError('Uso: `!admin moedas @jogador <quantidade> [motivo]`');
      const amount = Number(amountToken);
      const reason = freeText(ctx.args.slice(1).filter((a) => a !== amountToken)) || `Ajuste por ${ctx.author.username}`;
      await ensurePlayer(prisma, refOf(user));
      const balance = await addCoins(prisma, user.id, amount, reason);
      await ctx.reply(`🪙 ${mention(user.id)}: ${amount >= 0 ? '+' : ''}${amount} FluxCoins (saldo ${balance}).`);
      return;
    }
    if (sub === 'placar') {
      await updateScoreboard(ctx.client);
      await ctx.reply('✅ Placar atualizado.');
      return;
    }
    if (sub === 'evento-semanal') {
      await openWeeklyEvent(ctx.client, ctx.author.id);
      await ctx.reply(`✅ Evento semanal aberto em #${config.channels.events}.`);
      return;
    }
    throw new UserError('Subcomando desconhecido. Veja `!ajuda admin`.');
  },
};
