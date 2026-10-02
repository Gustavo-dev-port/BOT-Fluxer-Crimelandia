/**
 * GET /health: estado do worker, do banco e do Gateway do Fluxer.
 * 200 + "healthy" quando tudo está bem; 503 + "unhealthy" caso contrário
 * (o Docker usa isso no HEALTHCHECK). Não expõe tokens nem dados de membros.
 */
import { createServer, type Server } from 'node:http';
import type { WorkerStatus } from './status.js';

export interface HealthReport {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  worker: 'running' | 'starting' | 'stopping';
  gateway: 'connected' | 'reconnecting';
  uptimeSeconds: number;
  reconnects: number;
}

export interface HealthOptions {
  /** Testa o banco (ex.: SELECT 1). */
  pingDatabase: () => Promise<unknown>;
  /** Tempo sem Gateway tolerado antes de ficar "unhealthy" (reconexões rápidas não contam). */
  gatewayGraceMs: number;
  /** Tempo máximo esperando o banco responder. */
  databaseTimeoutMs?: number;
}

async function databaseOk(ping: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((r) => (timer = setTimeout(() => r(false), timeoutMs)));
  const result = await Promise.race([
    ping().then(
      () => true,
      () => false,
    ),
    timeout,
  ]);
  clearTimeout(timer);
  return result;
}

export async function checkHealth(status: WorkerStatus, opts: HealthOptions): Promise<HealthReport> {
  const db = await databaseOk(opts.pingDatabase, opts.databaseTimeoutMs ?? 3000);
  status.database(db);
  const gatewayOk = status.gatewayConnected || status.gatewayDownFor() < opts.gatewayGraceMs;
  return {
    status: db && status.state === 'running' && gatewayOk ? 'healthy' : 'unhealthy',
    database: db ? 'connected' : 'disconnected',
    worker: status.state,
    gateway: status.gatewayConnected ? 'connected' : 'reconnecting',
    uptimeSeconds: status.uptimeSeconds(),
    reconnects: status.reconnects,
  };
}

export function startHealthServer(port: number, host: string, report: () => Promise<HealthReport>): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' || path !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    report().then(
      (r) => {
        res.writeHead(r.status === 'healthy' ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(r));
      },
      () => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy' }));
      },
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
