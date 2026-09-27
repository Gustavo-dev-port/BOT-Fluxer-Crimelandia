import { config } from '../config.js';
import { cmd, timeTag } from '../embeds/format.js';
import { tournamentEmbed } from '../embeds/tournamentEmbed.js';
import { latestNight, NightStatus } from '../services/night.js';
import type { Command } from './types.js';

const PHASE: Record<string, string> = {
  [NightStatus.VOTING]: '🗳️ Votação e inscrição abertas',
  [NightStatus.RUNNING]: '⚔️ Em andamento',
  [NightStatus.FINISHED]: '🏁 Encerrado',
  [NightStatus.CANCELLED]: '😴 Cancelado',
};

export const night: Command = {
  name: 'night',
  aliases: ['nightfluxer', 'semanal'],
  category: 'Times e campeonatos',
  usage: '',
  description: `Status do ${config.weeklyEvent.name}: fase, votação, inscritos, equipes, salas de voz e chave`,
  details: [
    'Toda semana (padrão: sexta 20h) o bot abre a votação do jogo e a inscrição em #eventos: reaja com o número do jogo e com ✅.',
    'Quando a inscrição fecha, as equipes são sorteadas, cada uma ganha uma sala de voz e a chave começa. Resultados com `!resultado`.',
  ],
  async execute(ctx) {
    const event = await latestNight();
    if (!event) {
      await ctx.reply(
        `🌙 Nenhum ${config.weeklyEvent.name} ainda. O próximo abre automaticamente (admins: ${cmd('admin')} evento-semanal).`,
      );
      return;
    }
    const when =
      event.status === NightStatus.VOTING
        ? ` · fecha ${timeTag(event.closesAt)}`
        : event.finishedAt
          ? ` · ${timeTag(event.finishedAt, 'f')}`
          : '';
    await ctx.reply({
      content: `**${PHASE[event.status] ?? event.status}**${when}`,
      embeds: [await tournamentEmbed(event.tournamentId)],
      allowed_mentions: { parse: [] },
    });
  },
};
