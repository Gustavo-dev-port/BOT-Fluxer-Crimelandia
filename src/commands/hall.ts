import { hallEmbed } from '../embeds/hallEmbed.js';
import { getHallOfFame } from '../services/hallOfFame.js';
import type { Command } from './types.js';

export const hall: Command = {
  name: 'hall',
  aliases: ['halldafama', 'hall-do-reino', 'fama'],
  category: 'Ranking',
  usage: '',
  description: 'Hall do Reino: campeão, MVP da semana, mais ativo, maior sequência, mais vitórias e mais FluxCoins',
  details: ['Também fica fixado em #hall-do-reino, atualizado a cada 10 minutos (crie o canal com `!setup`).'],
  async execute(ctx) {
    await ctx.reply({ allowed_mentions: { parse: [] }, embeds: [hallEmbed(await getHallOfFame())] });
  },
};
