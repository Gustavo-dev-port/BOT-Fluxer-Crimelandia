import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import type { Message, MessageCreateEvent, MessagePayload, User } from '../fluxer/types.js';
import { parseSmallId, parseUserMention } from '../utils/args.js';
import { UserError } from '../types/domain.js';
import type { PlayerRef } from '../services/players.js';

export type Category = 'Duelos' | 'Ranking' | 'Times e campeonatos' | 'Economia' | 'Promoções' | 'Administração';

export interface Command {
  name: string;
  aliases?: string[];
  category: Category;
  /** Ex.: `@amigo <jogo>` — o prefixo e o nome são adicionados na ajuda. */
  usage: string;
  description: string;
  /** Linhas extras para `!ajuda <comando>` (subcomandos, exemplos). */
  details?: string[];
  adminOnly?: boolean;
  execute(ctx: CommandContext): Promise<void>;
}

export function refOf(user: Pick<User, 'id' | 'username' | 'global_name'>): PlayerRef {
  return { id: user.id, username: user.global_name ?? user.username };
}

export class CommandContext {
  private adminCache: boolean | null = null;

  constructor(
    readonly client: FluxerClient,
    readonly message: MessageCreateEvent,
    readonly commandName: string,
    readonly args: string[],
    readonly rest: string,
  ) {}

  get author(): User {
    return this.message.author;
  }

  get channelId() {
    return this.message.channel_id;
  }

  async isAdmin(): Promise<boolean> {
    this.adminCache ??= await this.client.isAdmin(this.author.id, this.message.member?.roles);
    return this.adminCache;
  }

  async requireAdmin() {
    if (!(await this.isAdmin())) throw new UserError('Apenas admins (permissão **Gerenciar Servidor**) podem usar este comando.');
  }

  /** Responde à mensagem do comando. */
  reply(payload: MessagePayload | string): Promise<Message> {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    return this.client.send(this.channelId, {
      ...body,
      message_reference: { message_id: this.message.id, channel_id: this.channelId },
      allowed_mentions: body.allowed_mentions ?? { parse: ['users', 'roles'], replied_user: false },
    });
  }

  /** Usuários mencionados na ordem em que aparecem no texto. */
  async mentionedUsers(): Promise<User[]> {
    const users: User[] = [];
    for (const token of this.args) {
      const id = parseUserMention(token);
      if (!id || users.some((u) => u.id === id)) continue;
      users.push(this.message.mentions.find((m) => m.id === id) ?? (await this.client.rest.getUser(id)));
    }
    return users;
  }

  async requireUser(position = 0, label = 'jogador'): Promise<User> {
    const user = (await this.mentionedUsers())[position];
    if (!user) throw new UserError(`Mencione o ${label}. Uso: \`${this.usage()}\``);
    return user;
  }

  /** Primeiro `#n` / `n` dos argumentos (ID de partida ou campeonato). */
  smallId(): number | null {
    for (const a of this.args) {
      const id = parseSmallId(a);
      if (id !== null) return id;
    }
    return null;
  }

  requireSmallId(label: string): number {
    const id = this.smallId();
    if (id === null) throw new UserError(`Informe o ${label}. Uso: \`${this.usage()}\``);
    return id;
  }

  usageText = '';
  usage(): string {
    return this.usageText;
  }
}

export const usageOf = (c: Command) => `${config.prefix}${c.name}${c.usage ? ` ${c.usage}` : ''}`;
