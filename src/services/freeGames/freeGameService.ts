/**
 * Regras do módulo de jogos grátis:
 * - junta as fontes (uma com erro não derruba as outras) e remove duplicatas;
 * - publica só o que é novo e ainda está no prazo (máx. `maxPostsPerRun` por rodada);
 * - sem canal configurado, nada é marcado como visto;
 * - encerra os que passaram do prazo.
 */
import type { FreeGame } from '../../generated/prisma/client.js';
import type { FreeGameRepository } from '../../database/freeGameRepository.js';
import type { Logger } from '../promotions/promotionService.js';
import type { FreeGameOffer, FreeGameSource } from './types.js';

export interface FreeGamePublisher {
  publishNew(game: FreeGameOffer): Promise<{ channelId: string; messageId: string } | null>;
}

export interface FreeGameSettings {
  maxPostsPerRun: number;
  staleDays: number;
}

export interface FreeGameReport {
  fetched: number;
  posted: number;
  deferred: number;
  ended: number;
  failedSources: { source: string; error: string }[];
}

/** Remove duplicatas e itens vencidos; os que acabam antes vêm primeiro. */
export function selectCurrent(games: FreeGameOffer[], now: Date): FreeGameOffer[] {
  const byId = new Map<string, FreeGameOffer>();
  for (const g of games) {
    if (g.endsAt && g.endsAt <= now) continue;
    if (g.startsAt && g.startsAt > now) continue;
    byId.set(g.id, g);
  }
  return [...byId.values()].sort((a, b) => (a.endsAt?.getTime() ?? Infinity) - (b.endsAt?.getTime() ?? Infinity));
}

export class FreeGameService {
  private running = false;

  constructor(
    private readonly sources: FreeGameSource[],
    private readonly repo: FreeGameRepository,
    private readonly publisher: FreeGamePublisher,
    private readonly settings: FreeGameSettings,
    private readonly log: Logger,
  ) {}

  async sync(now = new Date()): Promise<FreeGameReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const results = await Promise.allSettled(this.sources.map((s) => s.fetchFreeGames(now)));
      const games: FreeGameOffer[] = [];
      const failedSources: FreeGameReport['failedSources'] = [];
      results.forEach((r, i) => {
        const source = this.sources[i].name;
        if (r.status === 'fulfilled') {
          games.push(...r.value);
          this.log.info(`${source}: ${r.value.length} jogos grátis`);
        } else {
          const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
          failedSources.push({ source, error });
          this.log.warn(`${source} falhou`, { error });
        }
      });

      const current = selectCurrent(games, now);
      const report: FreeGameReport = { fetched: games.length, posted: 0, deferred: 0, ended: 0, failedSources };
      let noChannel = false;
      for (const game of current) {
        const stored: FreeGame | null = await this.repo.find(game.id);
        if (stored) {
          await this.repo.refresh(game, now);
          continue;
        }
        if (noChannel || report.posted >= this.settings.maxPostsPerRun) {
          report.deferred++;
          continue;
        }
        const message = await this.publisher.publishNew(game);
        if (!message) {
          noChannel = true;
          report.deferred++;
          continue;
        }
        await this.repo.create(game, message, now);
        report.posted++;
      }
      report.ended = await this.repo.deactivateEnded(now, this.settings.staleDays);
      this.log.info('rodada de jogos grátis concluída', { ...report, failedSources: failedSources.length });
      return report;
    } finally {
      this.running = false;
    }
  }
}
