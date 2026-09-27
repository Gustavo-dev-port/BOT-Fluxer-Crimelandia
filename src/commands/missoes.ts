import { cmd, Colors, progressBar } from '../embeds/format.js';
import { claimRewards, getPlayerMissions, missionLabel } from '../services/missions.js';
import { MESSAGE_COOLDOWN_MS } from '../services/notifications/missionTracker.js';
import { UserError } from '../types/domain.js';
import { refOf, type Command } from './types.js';
import { ensurePlayer } from '../services/players.js';
import { prisma } from '../database/client.js';

export const missoes: Command = {
  name: 'missoes',
  aliases: ['missões', 'missao', 'missão', 'daily'],
  category: 'Economia',
  usage: '',
  description: 'Suas 3 missões do dia, com progresso e recompensa',
  details: [
    'Novas missões todo dia à meia-noite. Conclua e use `!coletar` para receber as FluxCoins.',
    `Contam: partidas confirmadas, minutos e entradas em salas de voz, mensagens (uma a cada ${MESSAGE_COOLDOWN_MS / 1000}s, sem comandos) e reações (uma por mensagem).`,
  ],
  async execute(ctx) {
    const missions = await getPlayerMissions(ctx.author.id);
    const lines = missions.map((m) => {
      const status = m.claimed ? '✅ coletada' : m.completed ? `🎁 pronta — use ${cmd('coletar')}` : `${m.progress}/${m.mission.target}`;
      return `${missionLabel(m.mission)} — 🪙 ${m.mission.reward}\n${progressBar(m.progress, m.mission.target)} ${status}`;
    });
    await ctx.reply({
      embeds: [
        {
          color: Colors.forest,
          title: '📜 Missões do dia',
          description: lines.join('\n\n'),
          footer: { text: 'Renovam à meia-noite' },
        },
      ],
    });
  },
};

export const coletar: Command = {
  name: 'coletar',
  aliases: ['claim', 'recompensa'],
  category: 'Economia',
  usage: '',
  description: 'Coleta as FluxCoins das missões concluídas',
  async execute(ctx) {
    await ensurePlayer(prisma, refOf(ctx.author));
    const { claimed, total, balance } = await claimRewards(ctx.author.id);
    if (!claimed.length) throw new UserError(`Nenhuma missão concluída para coletar. Veja o progresso com ${cmd('missoes')}.`);
    await ctx.reply({
      embeds: [
        {
          color: Colors.royalGold,
          title: `🪙 +${total} FluxCoins`,
          description: `${claimed.map((m) => `✅ ${missionLabel(m)} — ${m.reward}`).join('\n')}\n\nSaldo: **${balance}** FluxCoins`,
        },
      ],
    });
  },
};
