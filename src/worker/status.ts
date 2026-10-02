/**
 * Estado do worker para o health check e o watchdog: se está rodando, se o Gateway
 * do Fluxer está conectado e desde quando está fora.
 */
export type WorkerState = 'starting' | 'running' | 'stopping';

export class WorkerStatus {
  state: WorkerState = 'starting';
  readonly startedAt: number;
  gatewayConnected = false;
  /** Desde quando o Gateway está desconectado (null = conectado). */
  disconnectedSince: number | null;
  /** Desde quando o banco falha no health check (null = ok). */
  databaseFailingSince: number | null = null;
  reconnects = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
    this.disconnectedSince = this.startedAt;
  }

  private everConnected = false;

  gatewayUp() {
    if (!this.gatewayConnected && this.everConnected) this.reconnects++;
    this.everConnected = true;
    this.gatewayConnected = true;
    this.disconnectedSince = null;
  }

  gatewayDown() {
    if (this.gatewayConnected) this.disconnectedSince = this.now();
    this.gatewayConnected = false;
  }

  database(ok: boolean) {
    if (ok) this.databaseFailingSince = null;
    else this.databaseFailingSince ??= this.now();
  }

  /** Milissegundos sem Gateway (0 se conectado). */
  gatewayDownFor(): number {
    return this.disconnectedSince === null ? 0 : this.now() - this.disconnectedSince;
  }

  databaseDownFor(): number {
    return this.databaseFailingSince === null ? 0 : this.now() - this.databaseFailingSince;
  }

  uptimeSeconds(): number {
    return Math.floor((this.now() - this.startedAt) / 1000);
  }
}
