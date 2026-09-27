/** Repositório de jogos grátis já vistos/publicados. */
import type { FreeGame } from '@prisma/client';
import { type Db, prisma } from './client.js';
import type { FreeGameOffer } from '../services/freeGames/types.js';

const fields = (g: FreeGameOffer) => ({
  title: g.title,
  platform: g.platform,
  kind: g.kind,
  description: g.description,
  image: g.image,
  url: g.url,
  startsAt: g.startsAt,
  endsAt: g.endsAt,
});

export class FreeGameRepository {
  constructor(private readonly db: Db = prisma) {}

  find(id: string): Promise<FreeGame | null> {
    return this.db.freeGame.findUnique({ where: { id } });
  }

  create(g: FreeGameOffer, message: { channelId: string; messageId: string }, now: Date): Promise<FreeGame> {
    return this.db.freeGame.create({ data: { id: g.id, ...fields(g), ...message, firstSeenAt: now, lastSeenAt: now } });
  }

  /** Atualiza os dados (ex.: prazo mudou) e marca como visto. */
  refresh(g: FreeGameOffer, now: Date): Promise<FreeGame> {
    return this.db.freeGame.update({ where: { id: g.id }, data: { ...fields(g), active: true, lastSeenAt: now } });
  }

  /** Encerra os que passaram do prazo ou sumiram das fontes há `staleDays` dias. */
  async deactivateEnded(now: Date, staleDays: number): Promise<number> {
    const staleBefore = new Date(now.getTime() - staleDays * 86_400_000);
    const res = await this.db.freeGame.updateMany({
      where: { active: true, OR: [{ endsAt: { lte: now } }, { lastSeenAt: { lt: staleBefore } }] },
      data: { active: false },
    });
    return res.count;
  }

  /** Ativos e ainda no prazo, os que acabam primeiro antes. */
  listActive(now: Date): Promise<FreeGame[]> {
    return this.db.freeGame.findMany({
      where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ endsAt: { sort: 'asc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
    });
  }
}
