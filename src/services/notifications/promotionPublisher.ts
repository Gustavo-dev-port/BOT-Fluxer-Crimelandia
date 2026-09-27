/** Publica promoções no canal configurado do Fluxer. */
import { config } from '../../config.js';
import { guildSettings } from '../../database/guildSettingsRepository.js';
import type { StoredPromotion } from '../../database/promotionRepository.js';
import { promotionContent, promotionEmbed } from '../../embeds/promotionEmbed.js';
import type { FluxerClient } from '../../fluxer/client.js';
import type { PromotionPublisher } from '../promotions/promotionService.js';
import type { PromotionOffer } from '../promotions/types.js';
import { errorMeta, scoped } from '../../utils/logger.js';
import { getChannelId } from '../channels.js';

const log = scoped('promoções');

export class FluxerPromotionPublisher implements PromotionPublisher {
  constructor(private readonly client: FluxerClient) {}

  async publishNew(offer: PromotionOffer) {
    const channelId = await getChannelId(this.client, 'promo');
    if (!channelId) {
      log.warn(`canal de promoções não configurado; use ${config.prefix}config promo #canal`);
      return null;
    }
    const roleId = await guildSettings.getRole(this.client.guildId, 'promo');
    const content = promotionContent(offer, roleId, config.promotions.mentionDiscount);
    try {
      const msg = await this.client.send(channelId, {
        content,
        embeds: [promotionEmbed(offer)],
        // Só o cargo de promoções pode ser mencionado (nunca @everyone vindo do nome de um jogo).
        allowed_mentions: content && roleId ? { roles: [roleId] } : { parse: [] },
      });
      return { channelId, messageId: msg.id };
    } catch (err) {
      log.error('falha ao publicar promoção', { id: offer.id, ...errorMeta(err) });
      return null;
    }
  }

  async publishUpdate(stored: StoredPromotion, offer: PromotionOffer) {
    if (!stored.channelId || !stored.messageId) return;
    await this.client.rest
      .editMessage(stored.channelId, stored.messageId, { embeds: [promotionEmbed(offer, 'update')], allowed_mentions: { parse: [] } })
      .catch((err: unknown) => log.warn('falha ao atualizar mensagem da promoção', { id: offer.id, ...errorMeta(err) }));
  }
}
