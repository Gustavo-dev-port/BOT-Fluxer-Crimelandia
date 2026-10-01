/** Repositório de promoções já vistas/publicadas. */
import type { Promotion } from '../generated/prisma/client.js';
import { type Db, prisma } from './client.js';
import type { PromotionOffer } from '../services/promotions/types.js';

export type StoredPromotion = Promotion;

const offerFields = (o: PromotionOffer) => ({
  title: o.title,
  platform: o.platform,
  image: o.image,
  oldPrice: o.oldPrice,
  currentPrice: o.currentPrice,
  currency: o.currency,
  discount: o.discount,
  expiresAt: o.expiresAt,
  url: o.url,
});

export class PromotionRepository {
  constructor(private readonly db: Db = prisma) {}

  find(id: string): Promise<StoredPromotion | null> {
    return this.db.promotion.findUnique({ where: { id } });
  }

  create(offer: PromotionOffer, message: { channelId: string; messageId: string }, now = new Date()): Promise<StoredPromotion> {
    return this.db.promotion.create({
      data: {
        id: offer.id,
        ...offerFields(offer),
        channelId: message.channelId,
        messageId: message.messageId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  }

  /** Atualiza preço/dados e marca como vista agora. */
  update(offer: PromotionOffer, now = new Date()): Promise<StoredPromotion> {
    return this.db.promotion.update({
      where: { id: offer.id },
      data: { ...offerFields(offer), active: true, lastSeenAt: now },
    });
  }

  touch(id: string, now = new Date()): Promise<StoredPromotion> {
    return this.db.promotion.update({ where: { id }, data: { active: true, lastSeenAt: now } });
  }

  /**
   * Encerra promoções vencidas ou que sumiram das lojas há `staleDays` dias.
   * Retorna quantas foram encerradas.
   */
  async deactivateEnded(now: Date, staleDays: number): Promise<number> {
    const staleBefore = new Date(now.getTime() - staleDays * 86_400_000);
    const res = await this.db.promotion.updateMany({
      where: { active: true, OR: [{ expiresAt: { lt: now } }, { lastSeenAt: { lt: staleBefore } }] },
      data: { active: false },
    });
    return res.count;
  }

  listActive(limit: number): Promise<StoredPromotion[]> {
    return this.db.promotion.findMany({ where: { active: true }, orderBy: [{ discount: 'desc' }, { lastSeenAt: 'desc' }], take: limit });
  }
}
