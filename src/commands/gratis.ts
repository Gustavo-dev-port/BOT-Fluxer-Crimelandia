import { timeTag } from '../embeds/format.js';
import { FreeGameRepository } from '../database/freeGameRepository.js';
import { getFreeGameService } from '../schedulers/freeGameScheduler.js';
import type { Command } from './types.js';

const repo = new FreeGameRepository();

export const gratis: Command = {
  name: 'gratis',
  aliases: ['grátis', 'free', 'jogos-gratis'],
  category: 'Promoções',
  usage: '[atualizar]',
  description: 'Lista todos os jogos grátis ativos; `atualizar` (admin) busca agora',
  async execute(ctx) {
    if (ctx.args[0]?.toLowerCase() === 'atualizar') {
      await ctx.requireAdmin();
      const report = await getFreeGameService(ctx.client).sync();
      if (!report) {
        await ctx.reply('⏳ Já existe uma busca em andamento. Tente em instantes.');
        return;
      }
      const failed = report.failedSources.map((f) => `\`${f.source}\``).join(', ');
      await ctx.reply(
        `🔎 ${report.fetched} jogos grátis encontrados · 🆕 ${report.posted} publicados · ⏭️ ${report.deferred} para depois · 🏁 ${report.ended} encerrados` +
          (failed ? `\n⚠️ Falharam: ${failed} (veja logs/combined.log)` : ''),
      );
      return;
    }

    const list = await repo.listActive(new Date());
    const lines = list.map(
      (g) =>
        `${g.kind === 'free-weekend' ? '🎮' : '🎁'} [${g.title}](${g.url}) — ${g.platform}` +
        (g.kind === 'free-weekend' ? ' · Free Weekend' : '') +
        (g.endsAt ? ` · até ${timeTag(g.endsAt, 'R')}` : ''),
    );
    await ctx.reply({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          color: 0xa855f7,
          title: '🎁 Jogos grátis ativos',
          description: lines.length ? lines.join('\n').slice(0, 4000) : '_Nenhum jogo grátis no momento._',
        },
      ],
    });
  },
};
