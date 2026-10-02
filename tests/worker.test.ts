/**
 * Worker 24/7: GET /health, reconexão do Gateway, novos membros pelo Gateway,
 * watchdog, erro fatal e desligamento gracioso. O worker real contra o Fluxer falso.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/database/client.js';
import { guildSettings } from '../src/database/guildSettingsRepository.js';
import { Permission } from '../src/fluxer/permissions.js';
import { checkHealth } from '../src/worker/health.js';
import { WorkerStatus } from '../src/worker/status.js';
import { startWorker, type Worker } from '../src/worker/worker.js';
import { backoffDelay, retry } from '../src/utils/retry.js';
import { resetDb } from './helpers.js';
import { BOT_ID, GUILD_ID, MockFluxer, TOKEN, waitFor } from './mockFluxer.js';

async function until(check: () => Promise<boolean>, timeout = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('until: tempo esgotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('retry com espera exponencial', () => {
  it('dobra a espera a cada tentativa, até o teto', () => {
    const mid = () => 0.5; // sem variação
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, 1000, 30_000, mid))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('tenta de novo até dar certo, e desiste depois do limite', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    let calls = 0;
    const value = await retry(
      async () => {
        if (++calls < 3) throw new Error('fora do ar');
        return 'ok';
      },
      { attempts: 5, sleep },
    );
    expect(value).toBe('ok');
    expect(waits).toHaveLength(2);
    await expect(retry(async () => Promise.reject(new Error('sempre')), { attempts: 3, sleep })).rejects.toThrow('sempre');
  });
});

describe('health check', () => {
  it('healthy só com banco, worker rodando e Gateway conectado (com tolerância para reconexões)', async () => {
    let now = 0;
    const status = new WorkerStatus(() => now);
    const ok = { pingDatabase: async () => 1, gatewayGraceMs: 120_000 };
    expect((await checkHealth(status, ok)).status).toBe('unhealthy'); // iniciando
    status.state = 'running';
    status.gatewayUp();
    expect(await checkHealth(status, ok)).toMatchObject({
      status: 'healthy',
      database: 'connected',
      worker: 'running',
      gateway: 'connected',
    });

    status.gatewayDown();
    now = 60_000;
    expect(await checkHealth(status, ok)).toMatchObject({ status: 'healthy', gateway: 'reconnecting' });
    now = 200_000;
    expect((await checkHealth(status, ok)).status).toBe('unhealthy');
    status.gatewayUp();
    expect(status.reconnects).toBe(1);

    const dbDown = { pingDatabase: () => Promise.reject(new Error('banco fora')), gatewayGraceMs: 120_000 };
    expect(await checkHealth(status, dbDown)).toMatchObject({ status: 'unhealthy', database: 'disconnected' });
    now = 300_000;
    expect(status.databaseDownFor()).toBe(100_000);
  });
});

describe('worker contra o Fluxer falso', () => {
  let mock: MockFluxer;
  let worker: Worker;
  const fatal = vi.fn();
  const health = async () => {
    const res = await fetch(`http://127.0.0.1:${worker.healthPort}/health`);
    return { code: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    await resetDb();
    mock = await new MockFluxer().start();
    mock.roles.push({
      id: 'r-bot',
      name: 'Bot',
      color: 0,
      position: 50,
      permissions: Permission.MANAGE_ROLES.toString(),
      hoist: false,
      mentionable: false,
    });
    mock.memberRoles.set(BOT_ID, ['r-bot']);
    worker = await startWorker({
      instanceUrl: mock.origin,
      token: TOKEN,
      guildId: GUILD_ID,
      healthPort: 0,
      healthHost: '127.0.0.1',
      watchdogMinutes: 0,
      gatewayGraceMs: 120_000,
      schedulers: false,
      onFatal: fatal,
    });
  });

  afterAll(async () => {
    await worker.stop();
    await mock.stop();
    await prisma.$disconnect();
  });

  it('GET /health responde healthy quando conectado (e 404 em outras rotas)', async () => {
    await until(async () => (await health()).code === 200);
    expect((await health()).body).toMatchObject({ status: 'healthy', database: 'connected', worker: 'running', gateway: 'connected' });
    expect((await fetch(`http://127.0.0.1:${worker.healthPort}/outra`)).status).toBe(404);
  });

  it('novo membro pelo Gateway: cargo inicial e boas-vindas', async () => {
    await guildSettings.update(GUILD_ID, { welcomeChannelId: 'c-boas-vindas' });
    mock.dispatch('GUILD_MEMBER_ADD', {
      guild_id: GUILD_ID,
      user: { id: '800', username: 'novato', global_name: null, discriminator: '0000', avatar: null },
      nick: null,
      roles: [],
      joined_at: '2026-10-01T12:00:00.000Z',
    });
    const welcome = await waitFor(() => mock.callsTo('POST', /^\/channels\/c-boas-vindas\/messages$/)[0], 5000);
    expect(welcome.body.content).toContain('<@800>');
    expect(mock.memberRoles.get('800')).toHaveLength(1);
    expect(worker.client.memberCount).toBe(43);
  });

  it('reconecta sozinho quando a conexão cai, e o /health acompanha', async () => {
    const sockets = mock.sockets.length;
    mock.closeLatest(4000, 'queda');
    await until(async () => !worker.status.gatewayConnected, 2000);
    expect((await health()).body).toMatchObject({ status: 'healthy', gateway: 'reconnecting' }); // dentro da tolerância
    await until(async () => worker.status.gatewayConnected, 10_000);
    expect(mock.sockets.length).toBe(sockets + 1);
    // Retomou a mesma sessão (op 6 Resume) em vez de um novo Identify.
    expect(mock.gatewayFrames.some((f) => f.op === 6)).toBe(true);
    expect(worker.status.reconnects).toBe(1);
    expect((await health()).code).toBe(200);
    expect(fatal).not.toHaveBeenCalled();
  });

  it('desliga de forma limpa: para de aceitar eventos, fecha o Gateway e o /health', async () => {
    await worker.stop();
    expect(worker.status.state).toBe('stopping');
    const calls = mock.calls.length;
    await expect(fetch(`http://127.0.0.1:${worker.healthPort}/health`)).rejects.toThrow();
    // Chamar de novo não faz nada.
    await worker.stop();
    expect(mock.calls.length).toBe(calls);
  });
});

describe('erro fatal', () => {
  it('token recusado pelo Gateway (4004) chama onFatal para o processo reiniciar', async () => {
    const mock = await new MockFluxer().start();
    const fatal = vi.fn();
    const worker = await startWorker({
      instanceUrl: mock.origin,
      token: '555.errado',
      guildId: GUILD_ID,
      healthPort: null,
      watchdogMinutes: 0,
      gatewayGraceMs: 1000,
      schedulers: false,
      onFatal: fatal,
    });
    await waitFor(() => fatal.mock.calls.length > 0, 5000);
    expect(fatal.mock.calls[0][0]).toMatch(/4004/);
    await worker.stop();
    await mock.stop();
  });

  it('porta do /health ocupada não impede o worker de subir', async () => {
    const { createServer } = await import('node:http');
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r));
    const port = (busy.address() as { port: number }).port;
    const mock = await new MockFluxer().start();
    const worker = await startWorker({
      instanceUrl: mock.origin,
      token: TOKEN,
      guildId: GUILD_ID,
      healthPort: port,
      healthHost: '127.0.0.1',
      watchdogMinutes: 0,
      gatewayGraceMs: 1000,
      schedulers: false,
      onFatal: () => undefined,
    });
    expect(worker.healthPort).toBeNull();
    await until(async () => worker.status.gatewayConnected);
    await worker.stop();
    await mock.stop();
    await new Promise((r) => busy.close(r));
  });

  it('a inicialização desiste depois das tentativas quando o Fluxer não responde', async () => {
    await expect(
      startWorker({
        instanceUrl: 'http://127.0.0.1:1',
        token: TOKEN,
        guildId: GUILD_ID,
        healthPort: null,
        watchdogMinutes: 0,
        gatewayGraceMs: 1000,
        schedulers: false,
        onFatal: () => undefined,
        startupAttempts: 2,
      }),
    ).rejects.toThrow();
  });
});
