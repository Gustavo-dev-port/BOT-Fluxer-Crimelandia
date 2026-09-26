import { ChannelType, type Client, type Guild, type GuildTextBasedChannel, type MessageCreateOptions } from 'discord.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../services/settings.js';

export type ChannelKey = keyof typeof config.channels;

export async function getGuild(client: Client): Promise<Guild> {
  return client.guilds.fetch(config.guildId());
}

/** Canal configurado via /setup, ou encontrado pelo nome padrão. */
export async function getChannel(client: Client, key: ChannelKey): Promise<GuildTextBasedChannel | null> {
  const guild = await getGuild(client);
  const id = await getSetting(`channel:${key}`);
  if (id) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel?.isTextBased()) return channel;
  }
  const byName = guild.channels.cache.find((c) => c.name === config.channels[key] && c.type === ChannelType.GuildText);
  return byName?.isTextBased() ? byName : null;
}

export async function setChannel(key: ChannelKey, channelId: string) {
  await setSetting(`channel:${key}`, channelId);
}

export async function sendTo(client: Client, key: ChannelKey, payload: MessageCreateOptions) {
  const channel = await getChannel(client, key);
  if (!channel) {
    console.warn(`[canais] #${config.channels[key]} não configurado; mensagem descartada. Use /setup.`);
    return null;
  }
  return channel.send(payload).catch((err) => {
    console.error(`[canais] Falha ao enviar para #${config.channels[key]}:`, err);
    return null;
  });
}
