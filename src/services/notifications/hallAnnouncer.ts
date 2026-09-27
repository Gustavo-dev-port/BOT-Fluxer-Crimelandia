import { hallEmbed } from '../../embeds/hallEmbed.js';
import type { FluxerClient } from '../../fluxer/client.js';
import { getHallOfFame } from '../hallOfFame.js';
import { upsertPinnedMessage } from './pinnedMessage.js';

/** Atualiza a mensagem fixada do #hall-do-reino (ou cria, se não existir). */
export async function updateHallOfFame(client: FluxerClient) {
  const hall = await getHallOfFame();
  await upsertPinnedMessage(client, 'hall', 'hall', { embeds: [hallEmbed(hall)], allowed_mentions: { parse: [] } });
}
