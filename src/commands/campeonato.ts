import { announceTournamentProgress } from '../bot/announcer.js';
import { Colors } from '../bot/format.js';
import { announceTournament, FORMAT_LABEL, refreshTournamentMessage, tournamentEmbed } from '../bot/tournamentView.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { parseSmallId } from '../lib/args.js';
import { TournamentFormat, UserError } from '../lib/types.js';
import { resolveGame } from '../services/games.js';
import { consumeEventCredit } from '../services/shop.js';
import {
  cancelTournament,
  createTournament,
  getTournament,
  listTournaments,
  register,
  startTournament,
  unregister,
} from '../services/tournaments.js';
import { type Command, refOf } from './types.js';

const quiet = { allowed_mentions: { parse: [] as never[] } };

const FORMAT_ALIASES: Record<string, TournamentFormat> = {
  'mata-mata': TournamentFormat.SINGLE_ELIM,
  matamata: TournamentFormat.SINGLE_ELIM,
  chave: TournamentFormat.SINGLE_ELIM,
  eliminacao: TournamentFormat.SINGLE_ELIM,
  todos: TournamentFormat.ROUND_ROBIN,
  'todos-contra-todos': TournamentFormat.ROUND_ROBIN,
  'pontos-corridos': TournamentFormat.ROUND_ROBIN,
  liga: TournamentFormat.ROUND_ROBIN,
};

export const campeonato: Command = {
  name: 'campeonato',
  aliases: ['camp', 'torneio'],
  category: 'Times e campeonatos',
  usage: '<criar|iniciar|chave|listar|sair|cancelar> ...',
  description: 'Campeonatos: chave simples ou todos contra todos',
  details: [
    '`!campeonato criar "Nome" <jogo> [mata-mata|todos] [tamanho do time]` — admins, ou com crédito da loja',
    'Ex.: `!campeonato criar "Copa Crimelândia" CS2 mata-mata` · `!campeonato criar "Liga 2v2" Valorant todos 2`',
    '`!campeonato iniciar <id>` — fecha inscrições e gera a chave (criador ou admin)',
    '`!campeonato chave <id>` · `!campeonato listar` · `!campeonato sair <id>` · `!campeonato cancelar <id>`',
  ],
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'criar') {
      const [name, gameText, formatText, sizeText] = ctx.args.slice(1);
      if (!name || !gameText) throw new UserError('Uso: `!campeonato criar "Nome" <jogo> [mata-mata|todos] [tamanho do time]`');
      const format = formatText ? FORMAT_ALIASES[formatText.toLowerCase()] : TournamentFormat.SINGLE_ELIM;
      if (!format) throw new UserError('Formato inválido: use `mata-mata` ou `todos`.');
      const teamSize = sizeText ? parseSmallId(sizeText) : 1;
      if (!teamSize) throw new UserError('Tamanho do time inválido.');
      const game = await resolveGame(gameText);
      if (!(await ctx.isAdmin()) && !(await consumeEventCredit(ctx.author.id))) {
        throw new UserError(`Só admins podem criar campeonatos. Compre um **evento personalizado** na \`${config.prefix}loja\` para criar o seu!`);
      }
      const t = await createTournament({ name: name.slice(0, 60), game, format, teamSize, createdById: ctx.author.id });
      await announceTournament(ctx.client, t.id, `📢 Novo campeonato! Inscreva-se com \`${config.prefix}inscrever ${t.id}\`.`);
      await ctx.reply(`✅ Campeonato **${t.name}** (#${t.id}) criado e anunciado em #${config.channels.events}.`);
      return;
    }

    if (sub === 'listar' || sub === undefined) {
      const list = await listTournaments();
      const lines = list.map(
        (t) =>
          `\`#${t.id}\` **${t.name}** — ${t.game} · ${FORMAT_LABEL[t.format]} · ${t._count.entries} inscritos · ${t.status === 'RUNNING' ? '🎮 em andamento' : '📝 inscrições abertas'}`,
      );
      await ctx.reply({ embeds: [{ color: Colors.info, title: '🏆 Campeonatos', description: lines.join('\n') || '_Nenhum campeonato aberto._' }] });
      return;
    }

    const id = ctx.requireSmallId('ID do campeonato');

    if (sub === 'chave' || sub === 'ver') {
      await ctx.reply({ ...quiet, embeds: [await tournamentEmbed(id)] });
      return;
    }

    if (sub === 'sair') {
      await unregister(id, ctx.author.id);
      await refreshTournamentMessage(ctx.client, id);
      await ctx.reply('👋 Inscrição cancelada.');
      return;
    }

    const t = await getTournament(prisma, id);
    if (!(await ctx.isAdmin()) && t.createdById !== ctx.author.id) {
      throw new UserError('Só o criador do campeonato ou um admin pode fazer isso.');
    }

    if (sub === 'iniciar') {
      const progress = await startTournament(id);
      await refreshTournamentMessage(ctx.client, id);
      await ctx.reply({ ...quiet, content: `🚀 **${t.name}** começou!`, embeds: [await tournamentEmbed(id)] });
      await announceTournamentProgress(ctx.client, progress);
      return;
    }

    if (sub === 'cancelar') {
      await cancelTournament(id);
      await refreshTournamentMessage(ctx.client, id);
      await ctx.reply(`🚫 Campeonato **${t.name}** cancelado.`);
      return;
    }

    throw new UserError('Subcomando desconhecido. Veja `!ajuda campeonato`.');
  },
};

export const inscrever: Command = {
  name: 'inscrever',
  aliases: ['entrar'],
  category: 'Times e campeonatos',
  usage: '<campeonato> ["Nome do Time"]',
  description: 'Entra em um campeonato (ou reaja com ✅ no anúncio)',
  details: ['Individual: `!inscrever 3` · Em times (capitão): `!inscrever 3 "Os Brabos"`'],
  async execute(ctx) {
    const id = ctx.requireSmallId('ID do campeonato');
    const teamName = ctx.args.filter((a) => parseSmallId(a) === null).join(' ').trim() || null;
    const { tournament, label } = await register(id, refOf(ctx.author), teamName);
    await refreshTournamentMessage(ctx.client, id);
    await ctx.reply({ ...quiet, content: `📝 ${label} inscrito em **${tournament.name}**!` });
  },
};
