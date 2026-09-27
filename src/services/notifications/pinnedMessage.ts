import type { FluxerClient } from '../../fluxer/client.js';
import { FluxerApiError } from '../../fluxer/rest.js';
import type { MessagePayload } from '../../fluxer/types.js';
import { type ChannelKey, getChannelId } from '../channels.js';
import { getSetting, setSetting } from '../settings.js';
import { errorMeta, scoped } from '../../utils/logger.js';

const log = scoped('anúncios');

/**
 * Mantém uma mensagem fixada e sempre atualizada num canal (placar, Hall do Reino…).
 * Edita a mensagem salva em `<name>:messageId`; se ela sumiu ou o canal mudou, envia outra e fixa.
 */
export async function upsertPinnedMessage(client: FluxerClient, key: ChannelKey, name: string, payload: MessagePayload) {
  const channelId = await getChannelId(client, key);
  if (!channelId) return;
  const savedChannel = await getSetting(`${name}:channelId`);
  const messageId = await getSetting(`${name}:messageId`);
  if (messageId && savedChannel === channelId) {
    try {
      await client.rest.editMessage(channelId, messageId, payload);
      return;
    } catch (err) {
      // Mensagem apagada: cria outra abaixo.
      if (!(err instanceof FluxerApiError && err.status === 404)) {
        log.error(`falha ao editar a mensagem de ${name}`, errorMeta(err));
        return;
      }
    }
  }
  const sent = await client.send(channelId, payload).catch((err: unknown) => {
    log.error(`falha ao enviar a mensagem de ${name}`, errorMeta(err));
    return null;
  });
  if (sent) {
    await setSetting(`${name}:messageId`, sent.id);
    await setSetting(`${name}:channelId`, channelId);
    await client.rest.pinMessage(channelId, sent.id).catch(() => undefined);
  }
}
