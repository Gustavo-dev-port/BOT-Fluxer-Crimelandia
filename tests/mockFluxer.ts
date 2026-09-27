/**
 * Servidor Fluxer falso para testes, seguindo docs.fluxer.app:
 * descoberta (/.well-known/fluxer), HTTP API (/v1/...) e Gateway (WebSocket JSON).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface RecordedCall {
  method: string;
  path: string;
  body: any;
  headers: IncomingMessage['headers'];
  response?: any;
}

export const GUILD_ID = '9000';
export const BOT_ID = '1';
export const OWNER_ID = '999';
export const TOKEN = '555.segredo';

export const CHANNELS = {
  comandos: 'c-comandos',
  placar: 'c-placar',
  partidas: 'c-partidas',
  eventos: 'c-eventos',
  '💸┃promocoes': '7770001',
};

export class MockFluxer {
  private server!: Server;
  private wss!: WebSocketServer;
  calls: RecordedCall[] = [];
  gatewayFrames: any[] = [];
  sockets: WebSocket[] = [];
  private seq = 0;
  private nextMessageId = 10_000;
  /** Respostas 429 a devolver antes de atender (teste de rate limit). */
  rateLimitNext = 0;
  roles: any[] = [{ id: GUILD_ID, name: '@everyone', color: 0, position: 0, permissions: '0', hoist: false, mentionable: false }];
  memberRoles = new Map<string, string[]>();
  sessionId = 'sessao-1';
  port = 0;

  async start() {
    this.server = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url!, 'http://x');
      if (url.pathname !== '/gateway' || url.searchParams.get('v') !== '1') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop() {
    for (const s of this.sockets) s.terminate();
    this.wss.close();
    await new Promise((r) => this.server.close(r));
  }

  // ─── Gateway ──────────────────────────────────────────────────────────────

  private onSocket(ws: WebSocket) {
    this.sockets.push(ws);
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw));
      this.gatewayFrames.push(frame);
      if (frame.op === 1) ws.send(JSON.stringify({ op: 11 }));
      if (frame.op === 2) {
        if (frame.d.token !== TOKEN) return ws.close(4004, 'Invalid token');
        this.seq = 0;
        this.send(ws, 'READY', {
          session_id: this.sessionId,
          user: { id: BOT_ID, username: 'fluxerbot', bot: true },
          guilds: [{ id: GUILD_ID, unavailable: true }],
        });
        this.send(ws, 'GUILD_CREATE', {
          id: GUILD_ID,
          properties: { id: GUILD_ID, name: 'Crimelândia', owner_id: OWNER_ID },
          roles: this.roles,
          channels: Object.entries(CHANNELS).map(([name, id]) => ({ id, name, type: 0, guild_id: GUILD_ID })),
          members: [],
        });
      }
      if (frame.op === 6) {
        if (frame.d.session_id !== this.sessionId) return ws.send(JSON.stringify({ op: 9, d: false }));
        this.send(ws, 'RESUMED', {});
      }
    });
  }

  private send(ws: WebSocket, t: string, d: unknown) {
    ws.send(JSON.stringify({ op: 0, t, s: ++this.seq, d }));
  }

  /** Envia um Dispatch para o socket mais recente. */
  dispatch(t: string, d: unknown) {
    const ws = this.sockets.at(-1)!;
    this.send(ws, t, d);
  }

  closeLatest(code: number, reason = '') {
    this.sockets.at(-1)!.close(code, reason);
  }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString();
    const body = text ? JSON.parse(text) : undefined;
    const url = new URL(req.url!, 'http://x');
    const json = (status: number, data?: unknown) => {
      res.writeHead(status, data === undefined ? {} : { 'Content-Type': 'application/json' });
      res.end(data === undefined ? undefined : JSON.stringify(data));
    };

    if (url.pathname === '/.well-known/fluxer') {
      return json(200, {
        endpoints: {
          api: `${this.origin}/api`,
          api_client: `${this.origin}/api`,
          api_public: `${this.origin}/api`,
          gateway: `ws://127.0.0.1:${this.port}/gateway`,
          media: this.origin,
          webapp: this.origin,
        },
      });
    }

    const path = url.pathname.replace(/^\/api\/v1/, '');
    const call: RecordedCall = { method: req.method!, path, body, headers: req.headers };
    this.calls.push(call);

    if (req.headers.authorization !== `Bot ${TOKEN}`) return json(401, { code: 'UNAUTHORIZED', message: 'no' });
    if (this.rateLimitNext > 0) {
      this.rateLimitNext--;
      return json(429, { code: 'RATE_LIMITED', message: 'slow down', global: false, retry_after: 0.01 });
    }

    let m: RegExpExecArray | null;
    if (req.method === 'POST' && (m = /^\/channels\/([^/]+)\/messages$/.exec(path))) {
      call.response = this.message(m[1], String(this.nextMessageId++), body);
      return json(200, call.response);
    }
    if (req.method === 'PATCH' && (m = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(path))) {
      return json(200, this.message(m[1], m[2], body));
    }
    if (req.method === 'POST' && path === `/guilds/${GUILD_ID}/roles`) {
      const role = {
        id: `r${this.nextMessageId++}`,
        name: body.name,
        color: body.color ?? 0,
        position: 1,
        permissions: body.permissions ?? '0',
        hoist: false,
        mentionable: false,
      };
      this.roles.push(role);
      return json(200, role);
    }
    if (req.method === 'POST' && path === `/guilds/${GUILD_ID}/channels`) {
      return json(200, { id: `c${this.nextMessageId++}`, name: body.name, type: body.type, guild_id: GUILD_ID });
    }
    if (req.method === 'PUT' || req.method === 'DELETE') return json(204);
    if (path === `/guilds/${GUILD_ID}`) return json(200, { id: GUILD_ID, name: 'Crimelândia', owner_id: OWNER_ID });
    if (path === `/guilds/${GUILD_ID}/roles`) return json(200, this.roles);
    if (path === `/guilds/${GUILD_ID}/channels`) {
      return json(
        200,
        Object.entries(CHANNELS).map(([name, id]) => ({ id, name, type: 0, guild_id: GUILD_ID })),
      );
    }
    if ((m = new RegExp(`^/guilds/${GUILD_ID}/members/([^/]+)$`).exec(path))) {
      const id = m[1] === '@me' ? BOT_ID : m[1];
      return json(200, {
        user: { id, username: `u${id}` },
        roles: this.memberRoles.get(id) ?? [],
        nick: null,
        joined_at: new Date().toISOString(),
      });
    }
    if ((m = /^\/users\/([^/]+)$/.exec(path)))
      return json(200, { id: m[1], username: `u${m[1]}`, global_name: null, discriminator: '0000', avatar: null });
    return json(404, { code: 'NOT_FOUND', message: path });
  }

  private message(channelId: string, id: string, body: any) {
    return {
      id,
      channel_id: channelId,
      author: { id: BOT_ID, username: 'fluxerbot', bot: true },
      type: 0,
      content: body?.content ?? '',
      timestamp: new Date().toISOString(),
      mentions: [],
      mention_roles: [],
      embeds: body?.embeds ?? [],
    };
  }

  // ─── Ajudantes de teste ───────────────────────────────────────────────────

  callsTo(method: string, pattern: RegExp) {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path));
  }

  /** Mensagem criada pelo bot cuja primeira embed tem o título informado. */
  sentWithTitle(title: RegExp) {
    return this.callsTo('POST', /\/messages$/).filter((c) => c.body?.embeds?.some((e: any) => title.test(e.title ?? '')));
  }
}

export async function waitFor<T>(fn: () => T | undefined | null | false, timeout = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor: tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}
