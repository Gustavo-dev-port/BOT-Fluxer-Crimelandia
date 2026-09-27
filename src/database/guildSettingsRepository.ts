/**
 * Repositório de GuildSettings: canais e cargos configurados por servidor.
 */
import type { GuildSettings } from '@prisma/client';
import { type Db, prisma } from '../db.js';

/** Campos de canal que o bot usa, por chave lógica. */
export const CHANNEL_FIELDS = {
  commands: 'commandsChannelId',
  scoreboard: 'scoreboardChannelId',
  matches: 'matchesChannelId',
  events: 'eventChannelId',
  promo: 'promoChannelId',
  freeGames: 'freeGamesChannelId',
  music: 'musicChannelId',
} as const satisfies Record<string, keyof GuildSettings>;

export type ChannelKey = keyof typeof CHANNEL_FIELDS;

export const ROLE_FIELDS = {
  promo: 'promoRoleId',
  champion: 'championRoleId',
} as const satisfies Record<string, keyof GuildSettings>;

export type RoleKey = keyof typeof ROLE_FIELDS;

export type GuildSettingsPatch = Partial<Omit<GuildSettings, 'guildId' | 'createdAt' | 'updatedAt'>>;

export class GuildSettingsRepository {
  constructor(private readonly db: Db = prisma) {}

  /** Configuração do servidor, criando a linha na primeira vez. */
  get(guildId: string): Promise<GuildSettings> {
    return this.db.guildSettings.upsert({ where: { guildId }, create: { guildId }, update: {} });
  }

  update(guildId: string, patch: GuildSettingsPatch): Promise<GuildSettings> {
    return this.db.guildSettings.upsert({ where: { guildId }, create: { guildId, ...patch }, update: patch });
  }

  async getChannel(guildId: string, key: ChannelKey): Promise<string | null> {
    return (await this.get(guildId))[CHANNEL_FIELDS[key]];
  }

  setChannel(guildId: string, key: ChannelKey, channelId: string | null) {
    return this.update(guildId, { [CHANNEL_FIELDS[key]]: channelId });
  }

  async getRole(guildId: string, key: RoleKey): Promise<string | null> {
    return (await this.get(guildId))[ROLE_FIELDS[key]];
  }

  setRole(guildId: string, key: RoleKey, roleId: string | null) {
    return this.update(guildId, { [ROLE_FIELDS[key]]: roleId });
  }
}

export const guildSettings = new GuildSettingsRepository();
