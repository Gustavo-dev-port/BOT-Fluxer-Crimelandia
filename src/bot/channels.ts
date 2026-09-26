import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import { ChannelType, type Message, type MessagePayload, type Snowflake } from '../fluxer/types.js';
import { getSetting, setSetting } from '../services/settings.js';

export type ChannelKey = keyof typeof config.channels;

/** Canal configurado via !setup, ou encontrado pelo nome padrão. */
export async function getChannelId(client: FluxerClient, key: ChannelKey): Promise<Snowflake | null> {
  const saved = await getSetting(`channel:${key}`);
  if (saved) return saved;
  const channels = await client.rest.getGuildChannels(client.guildId).catch(() => []);
  const found = channels.find((c) => c.type === ChannelType.GUILD_TEXT && c.name === config.channels[key]);
  if (found) await setChannel(key, found.id);
  return found?.id ?? null;
}

export async function setChannel(key: ChannelKey, channelId: Snowflake) {
  await setSetting(`channel:${key}`, channelId);
}

export async function sendTo(client: FluxerClient, key: ChannelKey, payload: MessagePayload): Promise<Message | null> {
  const channelId = await getChannelId(client, key);
  if (!channelId) {
    console.warn(`[canais] #${config.channels[key]} não configurado; mensagem descartada. Use ${config.prefix}setup.`);
    return null;
  }
  return client.send(channelId, payload).catch((err) => {
    console.error(`[canais] Falha ao enviar para #${config.channels[key]}:`, err);
    return null;
  });
}
