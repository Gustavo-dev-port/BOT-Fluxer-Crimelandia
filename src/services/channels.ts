import { config } from '../config.js';
import { type ChannelKey, guildSettings } from '../database/guildSettingsRepository.js';
import type { FluxerClient } from '../fluxer/client.js';
import { ChannelType, type Message, type MessagePayload, type Snowflake } from '../fluxer/types.js';
import { getSetting } from './settings.js';
import { errorMeta, scoped } from '../utils/logger.js';

export type { ChannelKey };

const log = scoped('canais');

/** "📜┃eventos" → "eventos": ignora emojis, separadores e acentos para comparar nomes. */
export function normalizeChannelName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Canal configurado em GuildSettings (!config / !setup). Se não houver, tenta o
 * valor antigo da tabela Setting e, por fim, um canal de texto com o nome padrão;
 * o que encontrar fica salvo em GuildSettings.
 */
export async function getChannelId(client: FluxerClient, key: ChannelKey): Promise<Snowflake | null> {
  const configured = await guildSettings.getChannel(client.guildId, key);
  if (configured) return configured;

  const legacy = await getSetting(`channel:${key}`);
  if (legacy) {
    await guildSettings.setChannel(client.guildId, key, legacy);
    return legacy;
  }

  const wanted = normalizeChannelName(config.channels[key]);
  const channels = await client.rest.getGuildChannels(client.guildId).catch(() => []);
  const found = channels.find((c) => c.type === ChannelType.GUILD_TEXT && c.name && normalizeChannelName(c.name) === wanted);
  if (found) await guildSettings.setChannel(client.guildId, key, found.id);
  return found?.id ?? null;
}

export async function setChannel(client: FluxerClient, key: ChannelKey, channelId: Snowflake) {
  await guildSettings.setChannel(client.guildId, key, channelId);
}

export async function sendTo(client: FluxerClient, key: ChannelKey, payload: MessagePayload): Promise<Message | null> {
  const channelId = await getChannelId(client, key);
  if (!channelId) {
    log.warn(`#${config.channels[key]} não configurado; mensagem descartada. Use ${config.prefix}setup ou ${config.prefix}config.`);
    return null;
  }
  return client.send(channelId, payload).catch((err: unknown) => {
    log.error(`falha ao enviar para #${config.channels[key]}`, errorMeta(err));
    return null;
  });
}
