/** Publica jogos grátis no canal configurado do Fluxer. */
import { config } from '../../config.js';
import { freeGameEmbed } from '../../embeds/freeGameEmbed.js';
import type { FluxerClient } from '../../fluxer/client.js';
import type { FreeGamePublisher } from '../freeGames/freeGameService.js';
import type { FreeGameOffer } from '../freeGames/types.js';
import { errorMeta, scoped } from '../../utils/logger.js';
import { getChannelId } from '../channels.js';

const log = scoped('jogos grátis');

export class FluxerFreeGamePublisher implements FreeGamePublisher {
  constructor(private readonly client: FluxerClient) {}

  async publishNew(game: FreeGameOffer) {
    const channelId = await getChannelId(this.client, 'freeGames');
    if (!channelId) {
      log.warn(`canal de jogos grátis não configurado; use ${config.prefix}config jogos-gratis #canal`);
      return null;
    }
    try {
      const msg = await this.client.send(channelId, { embeds: [freeGameEmbed(game)], allowed_mentions: { parse: [] } });
      return { channelId, messageId: msg.id };
    } catch (err) {
      log.error('falha ao publicar jogo grátis', { id: game.id, ...errorMeta(err) });
      return null;
    }
  }
}
