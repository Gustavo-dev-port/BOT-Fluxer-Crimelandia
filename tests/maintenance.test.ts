/**
 * Manutenção: itens temporários da loja vencidos só saem do banco quando o Fluxer
 * confirmou a remoção (ou o alvo já não existe); uma falha passageira tenta de novo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/client.js';
import { FluxerClient } from '../src/fluxer/client.js';
import { removeExpiredRoles, restoreExpiredNicknames } from '../src/schedulers/maintenanceScheduler.js';
import { ensurePlayer } from '../src/services/players.js';
import { resetDb } from './helpers.js';
import { GUILD_ID, MockFluxer, TOKEN } from './mockFluxer.js';

let mock: MockFluxer;
let client: FluxerClient;
const past = () => new Date(Date.now() - 60_000);

beforeAll(async () => {
  mock = await new MockFluxer().start();
  client = await FluxerClient.create(mock.origin, TOKEN, GUILD_ID);
});

afterAll(async () => {
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  mock.calls = [];
  mock.serverErrorNext = 0;
  mock.strictRoles = false;
  await ensurePlayer(prisma, { id: '100', username: 'vip' });
});

describe('itens temporários vencidos', () => {
  it('cargo VIP vencido: com o Fluxer instável, continua na fila e sai na rodada seguinte', async () => {
    await prisma.tempRole.create({ data: { playerId: '100', roleId: '8400', expiresAt: past() } });
    mock.serverErrorNext = 1;
    await removeExpiredRoles(client);
    expect(await prisma.tempRole.count()).toBe(1); // não perdeu o registro

    await removeExpiredRoles(client);
    expect(await prisma.tempRole.count()).toBe(0);
    expect(mock.callsTo('DELETE', new RegExp(`^/guilds/${GUILD_ID}/members/100/roles/8400$`))).toHaveLength(2);
  });

  it('cargo que já não existe (404) sai do banco sem insistir', async () => {
    mock.strictRoles = true; // 8401 não existe no servidor falso
    await prisma.tempRole.create({ data: { playerId: '100', roleId: '8401', expiresAt: past() } });
    await removeExpiredRoles(client);
    expect(await prisma.tempRole.count()).toBe(0);
  });

  it('apelido especial vencido: falha passageira mantém o registro para devolver depois', async () => {
    await prisma.tempNickname.create({ data: { playerId: '100', nick: 'Rei do Clutch', previousNick: 'vip', expiresAt: past() } });
    mock.serverErrorNext = 1;
    await restoreExpiredNicknames(client);
    expect(await prisma.tempNickname.count()).toBe(1);
    await restoreExpiredNicknames(client);
    expect(await prisma.tempNickname.count()).toBe(0);
    expect(mock.callsTo('PATCH', new RegExp(`^/guilds/${GUILD_ID}/members/100$`)).at(-1)?.body).toEqual({ nick: 'vip' });
  });

  it('itens ainda válidos não são tocados', async () => {
    await prisma.tempRole.create({ data: { playerId: '100', roleId: '8402', expiresAt: new Date(Date.now() + 86_400_000) } });
    await removeExpiredRoles(client);
    expect(await prisma.tempRole.count()).toBe(1);
    expect(mock.calls).toHaveLength(0);
  });
});
