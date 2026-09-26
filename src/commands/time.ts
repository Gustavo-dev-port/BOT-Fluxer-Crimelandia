import { attachPrompt, challengeEmbed } from '../bot/announcer.js';
import { Colors, mention } from '../bot/format.js';
import { parseUserMention } from '../lib/args.js';
import { UserError } from '../lib/types.js';
import { resolveGame } from '../services/games.js';
import { createTeamChallenge } from '../services/matches.js';
import { createTeam, disbandTeam, getTeamByName, leaveTeam, listTeams } from '../services/teams.js';
import { type Command, type CommandContext, refOf } from './types.js';

const quiet = { allowed_mentions: { parse: [] as never[] } };

/** Argumentos depois do subcomando, sem as menções. */
function textArgs(ctx: CommandContext): string[] {
  return ctx.args.slice(1).filter((a) => !parseUserMention(a));
}

function requireName(ctx: CommandContext): string {
  const name = textArgs(ctx).join(' ').trim();
  if (!name) throw new UserError(`Informe o nome do time. Uso: \`${ctx.usage()}\``);
  return name;
}

export const time: Command = {
  name: 'time',
  aliases: ['times', 'equipe'],
  category: 'Times e campeonatos',
  usage: '<criar|info|listar|sair|desfazer|desafiar> ...',
  description: 'Times para partidas 2v2, 3v3 ou squads (até 10)',
  details: [
    '`!time criar <nome> @membro1 @membro2…` — você é o capitão',
    '`!time info <nome>` · `!time listar [@jogador]`',
    '`!time sair <nome>` · `!time desfazer <nome>` (capitão)',
    '`!time desafiar "Meu Time" "Time Adversário" <jogo>` — use aspas em nomes com espaço',
  ],
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'criar') {
      const members = await ctx.mentionedUsers();
      if (members.some((u) => u.bot)) throw new UserError('Bots não podem entrar em times.');
      const team = await createTeam(requireName(ctx), refOf(ctx.author), members.map(refOf));
      await ctx.reply({
        ...quiet,
        embeds: [
          {
            color: Colors.success,
            title: `🛡️ Time ${team.name} criado`,
            description: `Capitão: ${mention(team.captainId)}\nMembros: ${team.members.map((m) => mention(m.playerId)).join(', ')}`,
          },
        ],
      });
      return;
    }

    if (sub === 'info') {
      const team = await getTeamByName(requireName(ctx));
      await ctx.reply({
        ...quiet,
        embeds: [
          {
            color: Colors.info,
            title: `🛡️ ${team.name}`,
            description: team.members.map((m) => `${m.playerId === team.captainId ? '👑' : '•'} ${mention(m.playerId)}`).join('\n'),
            footer: { text: `${team.members.length} jogadores` },
          },
        ],
      });
      return;
    }

    if (sub === 'listar' || sub === undefined) {
      const user = (await ctx.mentionedUsers())[0];
      const teams = await listTeams(user?.id);
      const lines = teams.map((t) => `**${t.name}** — ${t.members.length} jogadores · capitão ${mention(t.captainId)}`);
      await ctx.reply({
        ...quiet,
        embeds: [{ color: Colors.info, title: '🛡️ Times', description: lines.length ? lines.join('\n').slice(0, 4000) : '_Nenhum time criado._' }],
      });
      return;
    }

    if (sub === 'sair') {
      const name = requireName(ctx);
      const res = await leaveTeam(name, ctx.author.id);
      const extra = res.disbanded ? ' O time ficou vazio e foi desfeito.' : res.newCaptainId ? ` Novo capitão: ${mention(res.newCaptainId)}.` : '';
      await ctx.reply(`👋 Você saiu de **${name}**.${extra}`);
      return;
    }

    if (sub === 'desfazer') {
      const team = await disbandTeam(requireName(ctx), ctx.author.id, await ctx.isAdmin());
      await ctx.reply(`🗑️ Time **${team.name}** desfeito.`);
      return;
    }

    if (sub === 'desafiar') {
      const [mineName, otherName, ...gameParts] = textArgs(ctx);
      if (!mineName || !otherName || !gameParts.length) {
        throw new UserError('Uso: `!time desafiar "Meu Time" "Time Adversário" <jogo>` (aspas em nomes com espaço).');
      }
      const [mine, other] = await Promise.all([getTeamByName(mineName), getTeamByName(otherName)]);
      const game = await resolveGame(gameParts.join(' '));
      const { match, team2 } = await createTeamChallenge(ctx.author.id, mine.id, other.id, game);
      const msg = await ctx.reply({
        content: `${mention(team2.captainId)} (capitão de **${team2.name}**)`,
        embeds: [await challengeEmbed(match)],
      });
      await attachPrompt(ctx.client, msg, 'challenge', match.id);
      return;
    }

    throw new UserError(`Subcomando desconhecido. Veja \`!ajuda time\`.`);
  },
};
