import { Colors } from '../embeds/format.js';
import { config } from '../config.js';
import { UserError } from '../types/domain.js';
import { admin, jogo, setup, temporada } from './admin.js';
import { campeonato, inscrever } from './campeonato.js';
import { configCommand } from './config.js';
import { aceitar, cancelar, confirmar, contestar, duelo, partidas, recusar, resultado } from './duelo.js';
import { loja, resgatar, saldo, titulo } from './economia.js';
import { perfil, rank, rival, rivalidades, top10 } from './ranking.js';
import { hall } from './hall.js';
import { coletar, missoes } from './missoes.js';
import { night } from './night.js';
import { grupo } from './grupo.js';
import { gratis } from './gratis.js';
import { promocoes } from './promocoes.js';
import { time } from './time.js';
import { type Category, type Command, usageOf } from './types.js';

const ajuda: Command = {
  name: 'ajuda',
  aliases: ['help', 'comandos'],
  category: 'Duelos',
  usage: '[comando]',
  description: 'Lista os comandos, ou explica um comando',
  async execute(ctx) {
    const wanted = ctx.args[0]?.toLowerCase().replace(config.prefix, '');
    if (wanted) {
      const c = findCommand(wanted);
      if (!c) throw new UserError(`Comando \`${wanted}\` não existe. Veja \`${config.prefix}ajuda\`.`);
      const aliases = c.aliases?.length ? `\nAtalhos: ${c.aliases.map((a) => `\`${config.prefix}${a}\``).join(', ')}` : '';
      await ctx.reply({
        embeds: [
          {
            color: Colors.info,
            title: `\`${usageOf(c)}\``,
            description: [c.description + (c.adminOnly ? ' _(admin)_' : ''), ...(c.details ?? [])].join('\n') + aliases,
          },
        ],
      });
      return;
    }
    const categories: Category[] = ['Duelos', 'Ranking', 'Times e campeonatos', 'Economia', 'Promoções', 'Administração'];
    await ctx.reply({
      embeds: [
        {
          color: Colors.primary,
          title: '⚔️ Fluxer BOT — comandos',
          description: `Detalhes de um comando: \`${config.prefix}ajuda <comando>\``,
          fields: categories.map((cat) => ({
            name: cat,
            value: commands
              .filter((c) => c.category === cat)
              .map((c) => `\`${usageOf(c)}\` — ${c.description}`)
              .join('\n'),
          })),
        },
      ],
    });
  },
};

export const commands: Command[] = [
  ajuda,
  // Duelos
  duelo,
  aceitar,
  recusar,
  cancelar,
  resultado,
  confirmar,
  contestar,
  partidas,
  // Ranking
  rank,
  top10,
  perfil,
  rival,
  rivalidades,
  hall,
  // Times e campeonatos
  time,
  campeonato,
  inscrever,
  night,
  grupo,
  // Economia
  loja,
  resgatar,
  titulo,
  saldo,
  missoes,
  coletar,
  // Promoções
  promocoes,
  gratis,
  // Administração
  temporada,
  jogo,
  setup,
  configCommand,
  admin,
];

const byName = new Map<string, Command>();
for (const c of commands) {
  for (const n of [c.name, ...(c.aliases ?? [])]) {
    if (byName.has(n)) throw new Error(`Nome de comando duplicado: ${n}`);
    byName.set(n, c);
  }
}

export function findCommand(name: string): Command | undefined {
  return byName.get(name.toLowerCase());
}
