/**
 * Cliente do Gateway principal do Fluxer (WebSocket, JSON, sem compressão).
 * Segue https://docs.fluxer.app/gateway/overview:
 *   Hello (op 10) → Identify (op 2) ou Resume (op 6) → Ready → Heartbeat (op 1) a cada `heartbeat_interval`.
 * O Fluxer não tem intents: bots nunca são "passivos" e recebem os eventos dos servidores.
 */
import { EventEmitter } from 'node:events';
import type { User } from './types.js';

const Op = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/** Códigos de fechamento que não adianta tentar de novo (docs: /gateway/opcodes-and-close-codes). */
const FATAL_CLOSE_CODES: Record<number, string> = {
  4004: 'Token inválido',
  4010: 'Shard inválido',
  4011: 'Sharding obrigatório',
  4012: 'Versão de API inválida',
};
/** 4007 (sequência inválida) invalida a sessão: próxima conexão faz Identify. */
const RESET_SESSION_CODES = new Set([4007]);
/** Código que o próprio bot usa ao fechar para reconectar. */
const CLIENT_RECONNECT_CODE = 4900;

interface Payload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

export interface GatewayOptions {
  url: string;
  token: string;
  /** Eventos que o bot não quer receber (Identify `ignored_events`). */
  ignoredEvents?: string[];
}

export interface GatewayEvents {
  ready: [user: User];
  dispatch: [event: string, data: unknown];
  error: [error: Error];
  close: [code: number, reason: string];
}

export class Gateway extends EventEmitter<GatewayEvents> {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private identifyTimer: NodeJS.Timeout | null = null;
  private heartbeatAcked = true;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  user: User | null = null;

  constructor(private readonly options: GatewayOptions) {
    super();
  }

  connect() {
    this.stopped = false;
    const url = new URL(this.options.url);
    url.searchParams.set('v', '1');
    url.searchParams.set('encoding', 'json');

    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return; // sem compressão negociada, tudo chega como texto
      let payload: Payload;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        this.emit('error', new Error(`Payload inválido do Gateway: ${String(err)}`));
        return;
      }
      this.onPayload(payload);
    });
    ws.addEventListener('close', (event) => this.onClose(ws, event.code, event.reason));
    ws.addEventListener('error', () => {
      /* o evento 'close' vem em seguida e cuida da reconexão */
    });
  }

  /** Encerra de vez (sem reconectar). */
  destroy() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000, 'Desligando');
    this.ws = null;
  }

  /**
   * Entra, troca ou sai de um canal de voz (op 4, docs: /gateway/commands#voice-state-update).
   * O Fluxer responde com VOICE_STATE_UPDATE e, ao entrar, VOICE_SERVER_UPDATE (token LiveKit).
   */
  updateVoiceState(state: {
    guild_id: string;
    channel_id: string | null;
    connection_id?: string;
    self_mute?: boolean;
    self_deaf?: boolean;
  }) {
    this.send({ op: Op.VOICE_STATE_UPDATE, d: state });
  }

  private send(payload: Payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private onPayload(payload: Payload) {
    switch (payload.op) {
      case Op.HELLO: {
        const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(heartbeat_interval);
        if (this.sessionId && this.sequence !== null) this.resume();
        else this.identify();
        break;
      }
      case Op.HEARTBEAT:
        // O servidor pediu um heartbeat imediato.
        this.sendHeartbeat();
        break;
      case Op.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;
      case Op.DISPATCH:
        if (typeof payload.s === 'number') this.sequence = payload.s;
        this.onDispatch(payload.t!, payload.d);
        break;
      case Op.RECONNECT:
        // O servidor vai fechar com 4000; reconectamos e fazemos Resume.
        this.reconnect(true);
        break;
      case Op.INVALID_SESSION:
        // d é sempre false: a sessão não pode ser retomada. O socket continua aberto e aceita Identify.
        this.sessionId = null;
        this.sequence = null;
        setTimeout(() => this.identify(), 1000 + Math.random() * 4000);
        break;
    }
  }

  private onDispatch(event: string, data: unknown) {
    if (event === 'READY') {
      const ready = data as { session_id: string; user: User };
      this.sessionId = ready.session_id;
      this.user = ready.user;
      this.reconnectAttempts = 0;
      if (this.identifyTimer) clearTimeout(this.identifyTimer);
      this.emit('ready', ready.user);
    } else if (event === 'RESUMED') {
      this.reconnectAttempts = 0;
    }
    this.emit('dispatch', event, data);
  }

  private identify() {
    this.send({
      op: Op.IDENTIFY,
      d: {
        token: this.options.token,
        properties: { os: process.platform, browser: 'fluxer-bot-crimelandia', device: 'fluxer-bot-crimelandia' },
        presence: { status: 'online', afk: false, mobile: false },
        ignored_events: this.options.ignoredEvents ?? [],
      },
    });
    // Um Identify acima do limite é descartado sem resposta; se o Ready não vier, tentamos de novo.
    if (this.identifyTimer) clearTimeout(this.identifyTimer);
    this.identifyTimer = setTimeout(() => {
      if (!this.user || !this.sessionId) this.reconnect(false);
    }, 60_000);
  }

  private resume() {
    this.send({ op: Op.RESUME, d: { token: this.options.token, session_id: this.sessionId, seq: this.sequence } });
  }

  private startHeartbeat(interval: number) {
    this.clearTimers();
    this.heartbeatAcked = true;
    const beat = () => {
      if (!this.heartbeatAcked) {
        // Conexão "zumbi": nenhum ACK desde o último heartbeat.
        this.reconnect(true);
        return;
      }
      this.heartbeatAcked = false;
      this.sendHeartbeat();
    };
    // Primeiro heartbeat com jitter, depois no intervalo anunciado.
    this.heartbeatTimer = setTimeout(() => {
      beat();
      this.heartbeatTimer = setInterval(beat, interval);
    }, interval * Math.random());
  }

  private sendHeartbeat() {
    this.send({ op: Op.HEARTBEAT, d: this.sequence });
  }

  private clearTimers() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      clearInterval(this.heartbeatTimer);
    }
    if (this.identifyTimer) clearTimeout(this.identifyTimer);
    this.heartbeatTimer = null;
    this.identifyTimer = null;
  }

  /** Fecha o socket atual e abre outro; `resume` mantém a sessão para Resume. */
  private reconnect(resume: boolean) {
    if (!resume) {
      this.sessionId = null;
      this.sequence = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    ws?.close(CLIENT_RECONNECT_CODE, 'Reconectando');
    this.scheduleConnect();
  }

  private onClose(ws: WebSocket, code: number, reason: string) {
    this.emit('close', code, reason);
    // Um socket substituído por reconnect() já foi tratado.
    if (ws !== this.ws) return;
    this.ws = null;
    this.clearTimers();
    if (this.stopped) return;

    if (FATAL_CLOSE_CODES[code]) {
      this.stopped = true;
      this.emit('error', new Error(`Gateway fechou com ${code} (${FATAL_CLOSE_CODES[code]}): ${reason}`));
      return;
    }
    if (RESET_SESSION_CODES.has(code)) {
      this.sessionId = null;
      this.sequence = null;
    }
    this.scheduleConnect();
  }

  private scheduleConnect() {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts) + Math.random() * 1000;
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.stopped && !this.ws) this.connect();
    }, delay);
  }
}
