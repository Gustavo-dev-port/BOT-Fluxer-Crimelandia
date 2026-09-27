import { Colors, timeTag } from '../embeds/format.js';
import { config } from '../config.js';
import { PromotionRepository } from '../database/promotionRepository.js';
import { formatMoney } from '../embeds/promotionEmbed.js';
import { getPromotionService } from '../schedulers/promotionScheduler.js';
import type { Command } from './types.js';

const repo = new PromotionRepository();

export const promocoes: Command = {
  name: 'promocoes',
  aliases: ['promoções', 'promo', 'ofertas'],
  category: 'Promoções',
  usage: '[atualizar]',
  description: 'Lista as melhores promoções ativas; `atualizar` (admin) busca agora nas lojas',
  details: [`Descontos a partir de ${config.promotions.minDiscount}%. Lojas: ${config.promotions.sources.join(', ')}.`],
  async execute(ctx) {
    if (ctx.args[0]?.toLowerCase() === 'atualizar') {
      await ctx.requireAdmin();
      const report = await getPromotionService(ctx.client).sync();
      if (!report) {
        await ctx.reply('⏳ Já existe uma busca em andamento. Tente em instantes.');
        return;
      }
      const failed = report.failedSources.map((f) => `\`${f.source}\``).join(', ');
      await ctx.reply(
        `🔎 ${report.fetched} ofertas lidas, ${report.eligible} com ${config.promotions.minDiscount}%+ de desconto.\n` +
          `🆕 ${report.posted} publicadas · 🔄 ${report.updated} atualizadas · ⏭️ ${report.deferred} para depois · 🏁 ${report.ended} encerradas` +
          (failed ? `\n⚠️ Falharam: ${failed} (veja logs/combined.log)` : ''),
      );
      return;
    }

    const list = await repo.listActive(10);
    const lines = list.map(
      (p) =>
        `**-${p.discount}%** [${p.title}](${p.url}) — ${formatMoney(p.currentPrice, p.currency)} · ${p.platform}` +
        (p.expiresAt ? ` · até ${timeTag(p.expiresAt, 'R')}` : ''),
    );
    await ctx.reply({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          color: Colors.success,
          title: '💸 Melhores promoções ativas',
          description: lines.length ? lines.join('\n').slice(0, 4000) : '_Nenhuma promoção registrada ainda._',
        },
      ],
    });
  },
};
