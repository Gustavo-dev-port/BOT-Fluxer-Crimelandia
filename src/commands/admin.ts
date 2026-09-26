import { afterMatchConfirmed, announceSeasonEnd, resultEmbed, retirePrompts, updateScoreboard } from '../bot/announcer.js';
import { type ChannelKey, setChannel } from '../bot/channels.js';
import { Colors, mention, timeTag } from '../bot/format.js';
import { openWeeklyEvent } from '../bot/weeklyEvent.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { Permission } from '../fluxer/permissions.js';
import { ChannelType, type Embed } from '../fluxer/types.js';
import { freeText } from '../lib/args.js';
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
  name: 'setup',
  category: 'Administração',
  usage: '',
  description: 'Cria/configura os canais #comandos, #placar, #partidas e #eventos',
  adminOnly: true,
  async execute(ctx) {
    const { client } = ctx;
    const existing = await client.rest.getGuildChannels(client.guildId);
    const botId = client.botId!;
    const lines: string[] = [];
    for (const key of Object.keys(config.channels) as ChannelKey[]) {
      const name = config.channels[key];
      let channel = existing.find((c) => c.type === ChannelType.GUILD_TEXT && c.name === name);
      if (!channel) {
        channel = await client.rest.createGuildChannel(
          client.guildId,
          {
            name,
            type: ChannelType.GUILD_TEXT,
            topic: CHANNEL_TOPICS[key],
            // #placar é só leitura para os membros (o @everyone tem o mesmo ID do servidor).
            permission_overwrites:
              key === 'scoreboard'
                ? [
                    { id: client.guildId, type: 0, deny: Permission.SEND_MESSAGES.toString() },
                    { id: botId, type: 1, allow: (Permission.SEND_MESSAGES | Permission.PIN_MESSAGES).toString() },
                  ]
                : undefined,
          },
          'Fluxer BOT setup',
        );
        lines.push(`✨ criado <#${channel.id}>`);
      } else {
        lines.push(`✅ encontrado <#${channel.id}>`);
      }
      await setChannel(key, channel.id);
    }
    await updateScoreboard(client);
    await ctx.reply(`Canais configurados:\n${lines.join('\n')}`);
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
