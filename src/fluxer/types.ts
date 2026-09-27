/**
 * Tipos mínimos da API do Fluxer usados pelo bot.
 * Referência: https://docs.fluxer.app (HTTP API e Gateway).
 * Snowflakes e máscaras de permissão chegam como strings decimais.
 */

export type Snowflake = string;

/** https://docs.fluxer.app/http-api/users/#partial-user-object */
export interface User {
  id: Snowflake;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  bot?: boolean;
}

/** https://docs.fluxer.app/http-api/guild-members/#guild-member-object */
export interface GuildMember {
  user?: User;
  nick: string | null;
  roles: Snowflake[];
  joined_at: string;
}

/** https://docs.fluxer.app/http-api/permissions/#guild-role-object */
export interface Role {
  id: Snowflake;
  name: string;
  color: number;
  position: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
}

/** https://docs.fluxer.app/http-api/channels/#channel-types */
export const ChannelType = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
} as const;

export interface Channel {
  id: Snowflake;
  type: number;
  guild_id?: Snowflake;
  name?: string;
  parent_id?: Snowflake | null;
}

/** https://docs.fluxer.app/http-api/guilds/#guild-object */
export interface Guild {
  id: Snowflake;
  name: string;
  owner_id: Snowflake;
}

/** https://docs.fluxer.app/http-api/messages/#message-object */
export interface Message {
  id: Snowflake;
  channel_id: Snowflake;
  author: User;
  webhook_id?: Snowflake;
  type: number;
  content: string;
  timestamp: string;
  mentions: User[];
  mention_roles: Snowflake[];
  embeds: Embed[];
}

/** Payload de MESSAGE_CREATE: mensagem + campos extras do Gateway. */
export interface MessageCreateEvent extends Message {
  channel_type: number;
  guild_id?: Snowflake;
  /** Membro do autor, sem o campo `user` (o autor está em `author`). */
  member?: Omit<GuildMember, 'user'>;
}

/** https://docs.fluxer.app/gateway/events/#reaction-emoji-object */
export interface ReactionEmoji {
  name: string;
  id?: Snowflake;
}

/** Payload de MESSAGE_REACTION_ADD / MESSAGE_REACTION_REMOVE. */
export interface ReactionEvent {
  user_id: Snowflake;
  channel_id: Snowflake;
  message_id: Snowflake;
  emoji: ReactionEmoji;
  guild_id?: Snowflake;
  member?: GuildMember;
}

/** https://docs.fluxer.app/gateway/events/#guild-ready-object */
export interface GuildReady {
  id: Snowflake;
  unavailable?: boolean;
  properties?: Guild;
  roles?: Role[];
  channels?: Channel[];
  /** Quem está em voz nos canais que o bot vê (docs: guild ready object). */
  voice_states?: VoiceState[];
}

/** https://docs.fluxer.app/gateway/events/#voice-state-object */
export interface VoiceState {
  guild_id?: Snowflake | null;
  /** null = saiu da voz. */
  channel_id: Snowflake | null;
  user_id: Snowflake | null;
  member?: GuildMember | null;
  self_mute?: boolean;
  self_deaf?: boolean;
}

/** PASSIVE_UPDATES (servidores com mais de 250 membros). */
export interface PassiveUpdates {
  guild_id: Snowflake;
  voice_states?: VoiceState[];
}

/** https://docs.fluxer.app/http-api/messages/#rich-embed-object */
export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; url?: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

/** https://docs.fluxer.app/http-api/messages/#allowed-mentions-object */
export interface AllowedMentions {
  parse?: ('users' | 'roles' | 'everyone')[];
  users?: Snowflake[];
  roles?: Snowflake[];
  replied_user?: boolean;
}

/** Corpo de "Create message" / "Modify message". */
export interface MessagePayload {
  content?: string | null;
  embeds?: Embed[];
  allowed_mentions?: AllowedMentions;
  message_reference?: { message_id: Snowflake; channel_id?: Snowflake; type?: number };
}

/** https://docs.fluxer.app/http-api/guild-channels/#create-permission-overwrite-object */
export interface PermissionOverwrite {
  id: Snowflake;
  /** 0 = cargo, 1 = membro */
  type: 0 | 1;
  allow?: string;
  deny?: string;
}

/** https://docs.fluxer.app/http-api/instance/#instance-endpoints-object */
export interface InstanceEndpoints {
  api: string;
  api_client: string;
  api_public: string;
  gateway: string;
  media: string;
  webapp: string;
}
