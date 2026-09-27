import { afterMatchConfirmed, announceDisputed, attachPrompt, awaitingEmbed, challengeEmbed, resultEmbed } from '../bot/announcer.js';
import { type Actor, handleAccept, handleConfirm, handleDecline, handleDispute } from '../bot/duelActions.js';
import { Colors, mention, STATUS_LABEL, versus } from '../bot/format.js';
import { freeText, parseDuration } from '../lib/args.js';
import { UserError } from '../lib/types.js';
import { resolveGame } from '../services/games.js';
import { cancelDuel, createDuel, listOpenMatches, playersOnSide, reportResult } from '../services/matches.js';
import { type Command, type CommandContext, refOf } from './types.js';

const actorOf = (ctx: CommandContext): Actor => ({
  client: ctx.client,
  userId: ctx.author.id,
  respond: (payload) => ctx.reply(payload),
});

const ID_HINT = 'O `#partida` só é necessário se você tiver mais de uma partida aberta.';

export const duelo: Command = {
  name: 'duelo',
  aliases: ['desafiar', 'x1'],
  category: 'Duelos',
  usage: '@amigo <jogo>',
  description: 'Desafia um amigo para um duelo 1v1',
  details: ['Ex.: `!duelo @Lucas Valorant` · `!duelo @João League of Legends`'],
  async execute(ctx) {
    const opponent = await ctx.requireUser(0, 'oponente');
    if (opponent.bot) throw new UserError('Bots não aceitam desafios. 🤖');
    const gameText = freeText(ctx.args);
    if (!gameText) throw new UserError(`Informe o jogo. Uso: \`${ctx.usage()}\``);
    const game = await resolveGame(gameText);
    const match = await createDuel(refOf(ctx.author), refOf(opponent), game);
    const msg = await ctx.reply({ content: mention(opponent.id), embeds: [await challengeEmbed(match)] });
    await attachPrompt(ctx.client, msg, 'challenge', match.id);
  },
};

export const aceitar: Command = {
  name: 'aceitar',
  category: 'Duelos',
  usage: '[#partida]',
  description: 'Aceita um desafio pendente (ou reaja com ✅)',
  details: [ID_HINT],
  execute: (ctx) => handleAccept(actorOf(ctx), ctx.smallId()),
};

export const recusar: Command = {
  name: 'recusar',
  category: 'Duelos',
  usage: '[#partida]',
  description: 'Recusa um desafio pendente (ou reaja com ❌)',
  details: [ID_HINT],
  execute: (ctx) => handleDecline(actorOf(ctx), ctx.smallId()),
};

export const cancelar: Command = {
  name: 'cancelar',
  category: 'Duelos',
  usage: '[#partida]',
  description: 'Cancela um desafio que você criou',
  async execute(ctx) {
    const match = await cancelDuel(ctx.author.id, ctx.smallId(), await ctx.isAdmin());
    await ctx.reply({ embeds: [{ color: Colors.danger, title: `🚫 Partida #${match.id} cancelada`, description: await versus(match) }] });
  },
};

export const resultado: Command = {
  name: 'resultado',
  aliases: ['venci', 'placar-partida'],
  category: 'Duelos',
  usage: '@vencedor [duração] [#partida]',
  description: 'Registra quem venceu — o outro lado precisa confirmar',
  details: [
    'Em times, mencione qualquer jogador do time vencedor.',
    'Duração opcional (ex.: `25min`, `1h20`); sem ela, conta do aceite até o resultado.',
    ID_HINT,
  ],
  async execute(ctx) {
    const winner = await ctx.requireUser(0, 'vencedor');
    const duration = ctx.args.map(parseDuration).find((d): d is number => d !== null) ?? null;
    const outcome = await reportResult(ctx.author.id, winner.id, ctx.smallId(), duration);

    if (outcome.kind === 'awaiting') {
      const confirmSide = outcome.match.reportedSide === 1 ? 2 : 1;
      const msg = await ctx.reply({
        content: playersOnSide(outcome.match, confirmSide).map(mention).join(' '),
        embeds: [await awaitingEmbed(outcome.match)],
      });
      await attachPrompt(ctx.client, msg, 'confirm', outcome.match.id);
    } else if (outcome.kind === 'confirmed') {
      await ctx.reply({ embeds: [await resultEmbed(outcome.result)], allowed_mentions: { parse: [] } });
      await afterMatchConfirmed(ctx.client, outcome.result);
    } else {
      await ctx.reply({
        embeds: [
          {
            color: Colors.danger,
            title: `⚠️ Partida #${outcome.match.id} em disputa`,
            description: 'Os dois lados informaram vencedores diferentes. Um admin vai resolver.',
          },
        ],
      });
      await announceDisputed(ctx.client, outcome.match);
    }
  },
};

export const confirmar: Command = {
  name: 'confirmar',
  category: 'Duelos',
  usage: '[#partida]',
  description: 'Confirma o resultado informado pelo adversário (ou reaja com ✅)',
  execute: (ctx) => handleConfirm(actorOf(ctx), ctx.smallId()),
};

export const contestar: Command = {
  name: 'contestar',
  category: 'Duelos',
  usage: '[#partida]',
  description: 'Contesta o resultado informado pelo adversário (ou reaja com ⚠️)',
  execute: (ctx) => handleDispute(actorOf(ctx), ctx.smallId()),
};

export const partidas: Command = {
  name: 'partidas',
  category: 'Duelos',
  usage: '',
  description: 'Lista suas partidas em aberto',
  async execute(ctx) {
    const open = await listOpenMatches(ctx.author.id);
    const lines = await Promise.all(open.map(async (m) => `\`#${m.id}\` ${m.game} — ${await versus(m)} · ${STATUS_LABEL[m.status]}`));
    await ctx.reply({
      embeds: [
        {
          color: Colors.info,
          title: '📋 Suas partidas em aberto',
          description: lines.length ? lines.join('\n').slice(0, 4000) : '_Nenhuma partida em aberto._',
        },
      ],
      allowed_mentions: { parse: [] },
    });
  },
};
