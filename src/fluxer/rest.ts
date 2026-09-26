/**
 * Cliente HTTP da API do Fluxer.
 * - Base URL: `endpoints.api_public` da descoberta da instância (docs: /http-api/instance)
 * - Autenticação: `Authorization: Bot <token>` (docs: /authentication)
 * - Rate limit: 429 `RATE_LIMITED` com `retry_after` em segundos (docs: /topics/rate-limits)
 */
import type {
  Channel,
  Guild,
  GuildMember,
  InstanceEndpoints,
  Message,
  MessagePayload,
  PermissionOverwrite,
  Role,
  Snowflake,
  User,
} from './types.js';

/** Erro retornado pela API (docs: /http-api/#error-response). */
export class FluxerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly method: string,
    readonly path: string,
  ) {
    super(`${method} ${path} → ${status} ${code}: ${message}`);
  }
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lê `/.well-known/fluxer` da instância (não exige autenticação). */
export async function discoverInstance(instanceUrl: string): Promise<InstanceEndpoints> {
  const url = new URL('/.well-known/fluxer', instanceUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha na descoberta da instância ${url}: HTTP ${res.status}`);
  const body = (await res.json()) as { endpoints: InstanceEndpoints };
  return body.endpoints;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Vai para o cabeçalho X-Audit-Log-Reason. */
  reason?: string;
}

export class RestClient {
  private readonly base: string;

  constructor(
    apiPublic: string,
    private readonly token: string,
  ) {
    this.base = `${apiPublic.replace(/\/+$/, '')}/v1`;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
      'User-Agent': 'FluxerBot-Crimelandia (https://github.com/Gustavo-dev-port/BOT-Fluxer-Crimelandia, 1.0)',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    // Cabeçalhos HTTP só aceitam Latin-1; descarta emojis e afins.
    if (opts.reason) headers['X-Audit-Log-Reason'] = opts.reason.replace(/[^\x20-\xff]/g, '').trim();

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });

      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;
      if (res.ok) return data as T;

      // 429 (RATE_LIMITED ou RESOURCE_LOCKED) e 503 pedem para esperar e tentar de novo.
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const seconds = Number(data?.retry_after ?? res.headers.get('Retry-After') ?? 1);
        await sleep(Math.max(0.05, seconds) * 1000);
        continue;
      }
      throw new FluxerApiError(res.status, data?.code ?? 'UNKNOWN', data?.message ?? res.statusText, method, path);
    }
  }

  // ─── Usuários ─────────────────────────────────────────────────────────────
  getCurrentUser() {
    return this.request<User>('GET', '/users/@me');
  }
  getUser(userId: Snowflake) {
    return this.request<User>('GET', `/users/${userId}`);
  }

  // ─── Mensagens (docs: /http-api/messages) ─────────────────────────────────
  sendMessage(channelId: Snowflake, payload: MessagePayload) {
    return this.request<Message>('POST', `/channels/${channelId}/messages`, { body: payload });
  }
  editMessage(channelId: Snowflake, messageId: Snowflake, payload: MessagePayload) {
    return this.request<Message>('PATCH', `/channels/${channelId}/messages/${messageId}`, { body: payload });
  }
  pinMessage(channelId: Snowflake, messageId: Snowflake) {
    return this.request<void>('PUT', `/channels/${channelId}/pins/${messageId}`);
  }
  /** Emoji Unicode, ou `nome:id` para emoji personalizado. */
  addReaction(channelId: Snowflake, messageId: Snowflake, emoji: string) {
    return this.request<void>('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  }
  removeAllReactions(channelId: Snowflake, messageId: Snowflake) {
    return this.request<void>('DELETE', `/channels/${channelId}/messages/${messageId}/reactions`);
  }

  // ─── Servidor (docs: /http-api/guilds, /guild-channels, /guild-members) ───
  getGuild(guildId: Snowflake) {
    return this.request<Guild>('GET', `/guilds/${guildId}`);
  }
  getGuildChannels(guildId: Snowflake) {
    return this.request<Channel[]>('GET', `/guilds/${guildId}/channels`);
  }
  createGuildChannel(
    guildId: Snowflake,
    body: { name: string; type: number; topic?: string; parent_id?: Snowflake; permission_overwrites?: PermissionOverwrite[] },
    reason?: string,
  ) {
    return this.request<Channel>('POST', `/guilds/${guildId}/channels`, { body, reason });
  }
  getMember(guildId: Snowflake, userId: Snowflake) {
    return this.request<GuildMember>('GET', `/guilds/${guildId}/members/${userId}`);
  }
  getCurrentMember(guildId: Snowflake) {
    return this.request<GuildMember>('GET', `/guilds/${guildId}/members/@me`);
  }
  addMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake, reason?: string) {
    return this.request<void>('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
  }
  removeMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake, reason?: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
  }

  // ─── Cargos (docs: /http-api/permissions) ─────────────────────────────────
  getRoles(guildId: Snowflake) {
    return this.request<Role[]>('GET', `/guilds/${guildId}/roles`);
  }
  createRole(guildId: Snowflake, body: { name: string; color?: number; permissions?: string }, reason?: string) {
    return this.request<Role>('POST', `/guilds/${guildId}/roles`, { body, reason });
  }
  modifyRole(guildId: Snowflake, roleId: Snowflake, body: { name?: string; color?: number }, reason?: string) {
    return this.request<Role>('PATCH', `/guilds/${guildId}/roles/${roleId}`, { body, reason });
  }
  setRolePositions(guildId: Snowflake, positions: { id: Snowflake; position: number }[], reason?: string) {
    return this.request<Role[]>('PATCH', `/guilds/${guildId}/roles`, { body: positions, reason });
  }
  deleteRole(guildId: Snowflake, roleId: Snowflake, reason?: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/roles/${roleId}`, { reason });
  }
}
