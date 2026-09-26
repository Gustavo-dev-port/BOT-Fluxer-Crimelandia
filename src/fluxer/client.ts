/**
 * Junta REST + Gateway e guarda um cache pequeno do servidor (dono e cargos),
 * suficiente para checar permissões de admin.
 */
import { Gateway } from './gateway.js';
import { computeGuildPermissions, has, highestRolePosition, Permission } from './permissions.js';
import { discoverInstance, RestClient } from './rest.js';
import type { GuildReady, MessagePayload, Role, Snowflake, User } from './types.js';

const ROLE_CACHE_MS = 5 * 60_000;

export class FluxerClient {
  readonly gateway: Gateway;
  user: User | null = null;
  private ownerId: Snowflake | null = null;
  private roles: Role[] | null = null;
  private rolesFetchedAt = 0;

  private constructor(
    readonly rest: RestClient,
    gatewayUrl: string,
    token: string,
    readonly guildId: Snowflake,
    readonly apiPublicUrl: string,
  ) {
    this.gateway = new Gateway({ url: gatewayUrl, token, ignoredEvents: ['TYPING_START', 'PRESENCE_UPDATE'] });
    this.gateway.on('ready', (user) => (this.user = user));
    this.gateway.on('dispatch', (event, data) => this.updateCache(event, data));
  }

  /** Descobre os endpoints da instância e prepara os clientes. */
  static async create(instanceUrl: string, token: string, guildId: Snowflake) {
    const endpoints = await discoverInstance(instanceUrl);
    const rest = new RestClient(endpoints.api_public, token);
    return new FluxerClient(rest, endpoints.gateway, token, guildId, endpoints.api_public);
  }

  /**
   * Link de convite do bot (docs: GET /v1/oauth2/authorize com scope=bot).
   * O ID da aplicação é a parte do token antes do ponto.
   */
  inviteUrl(token: string, permissions: bigint): string {
    const url = new URL(`${this.apiPublicUrl.replace(/\/+$/, '')}/v1/oauth2/authorize`);
    url.searchParams.set('client_id', token.split('.')[0]);
    url.searchParams.set('scope', 'bot');
    url.searchParams.set('permissions', permissions.toString());
    url.searchParams.set('guild_id', this.guildId);
    return url.toString();
  }

  get botId(): Snowflake | null {
    return this.user?.id ?? null;
  }

  private updateCache(event: string, data: unknown) {
    if (event === 'GUILD_CREATE') {
      const guild = data as GuildReady;
      if (guild.id !== this.guildId) return;
      if (guild.properties) this.ownerId = guild.properties.owner_id;
      if (guild.roles) {
        this.roles = guild.roles;
        this.rolesFetchedAt = Date.now();
      }
    } else if (event === 'GUILD_UPDATE') {
      const guild = data as { id: Snowflake; owner_id: Snowflake };
      if (guild.id === this.guildId) this.ownerId = guild.owner_id;
    } else if (event.startsWith('GUILD_ROLE_')) {
      // Mais simples que aplicar cada mudança: busca de novo quando precisar.
      this.roles = null;
    }
  }

  async getRoles(): Promise<Role[]> {
    if (!this.roles || Date.now() - this.rolesFetchedAt > ROLE_CACHE_MS) {
      this.roles = await this.rest.getRoles(this.guildId);
      this.rolesFetchedAt = Date.now();
    }
    return this.roles;
  }

  async getOwnerId(): Promise<Snowflake> {
    if (!this.ownerId) this.ownerId = (await this.rest.getGuild(this.guildId)).owner_id;
    return this.ownerId;
  }

  /** Permissões de um membro; `memberRoles` evita buscar o membro quando já veio no evento. */
  async permissionsOf(userId: Snowflake, memberRoles?: Snowflake[]): Promise<bigint> {
    const roleIds = memberRoles ?? (await this.rest.getMember(this.guildId, userId)).roles;
    return computeGuildPermissions(this.guildId, await this.getOwnerId(), userId, roleIds, await this.getRoles());
  }

  /** Admin do bot = Gerenciar Servidor (ou Administrador, ou dono). */
  async isAdmin(userId: Snowflake, memberRoles?: Snowflake[]): Promise<boolean> {
    return has(await this.permissionsOf(userId, memberRoles), Permission.MANAGE_GUILD);
  }

  /** Posição do cargo mais alto do bot: cargos criados por ele precisam ficar abaixo disso. */
  async botTopRolePosition(): Promise<number> {
    const me = await this.rest.getCurrentMember(this.guildId);
    return highestRolePosition(me.roles, await this.getRoles());
  }

  send(channelId: Snowflake, payload: MessagePayload | string) {
    return this.rest.sendMessage(channelId, typeof payload === 'string' ? { content: payload } : payload);
  }

  login() {
    this.gateway.connect();
  }

  destroy() {
    this.gateway.destroy();
  }
}
