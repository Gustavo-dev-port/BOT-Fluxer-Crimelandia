/** Embed de promoção: "🟢 NOVA PROMOÇÃO" ou "🔄 PREÇO ATUALIZADO". */
import { timeTag } from '../bot/format.js';
import type { Embed } from '../fluxer/types.js';
import type { PromotionOffer } from '../services/promotions/types.js';

/** 2990, "BRL" → "R$ 29,90". */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function promotionEmbed(offer: PromotionOffer, kind: 'new' | 'update' = 'new'): Embed {
  const lines = [
    `**[${offer.title}](${offer.url})**`,
    `🏷️ ${offer.platform}`,
    '',
    `De: ~~${formatMoney(offer.oldPrice, offer.currency)}~~`,
    `Por: **${formatMoney(offer.currentPrice, offer.currency)}**`,
    `Desconto: **-${offer.discount}%**`,
    `Expira: ${offer.expiresAt ? `${timeTag(offer.expiresAt, 'f')} (${timeTag(offer.expiresAt, 'R')})` : 'não informado'}`,
    '',
    // O Fluxer não tem botões; o link faz o papel do "Ver oferta".
    `🔗 **[Ver oferta](${offer.url})**`,
  ];
  return {
    color: kind === 'new' ? 0x22c55e : 0x3b82f6,
    title: kind === 'new' ? '🟢 NOVA PROMOÇÃO' : '🔄 PREÇO ATUALIZADO',
    url: offer.url,
    description: lines.join('\n'),
    image: offer.image ? { url: offer.image } : undefined,
    footer: { text: offer.platform },
  };
}

/** Texto acima do embed: menciona o cargo quando o desconto é grande. */
export function promotionContent(offer: PromotionOffer, roleId: string | null, mentionDiscount: number): string | undefined {
  if (!roleId || offer.discount < mentionDiscount) return undefined;
  return `<@&${roleId}> 🔥 **-${offer.discount}%** em ${offer.title}!`;
}
