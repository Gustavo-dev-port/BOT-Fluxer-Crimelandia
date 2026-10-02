/**
 * Onboarding: entrada de membro, cargo inicial (Escudeiro), boas-vindas, segurança
 * (cargo administrativo, cargo excluído, outra comunidade, evento repetido) e a
 * promoção Escudeiro → Mercenário. O bot real contra o Fluxer falso.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { onMessageCreate } from '../src/events/messageCreate.js';
import { prisma } from '../src/database/client.js';
import { guildSettings } from '../src/database/guildSettingsRepository.js';
import { FluxerClient } from '../src/fluxer/client.js';
import { Permission } from '../src/fluxer/permissions.js';
import type { GuildMemberAddEvent, MessageCreateEvent, Role } from '../src/fluxer/types.js';
import { trackMission } from '../src/services/notifications/missionTracker.js';
import { onMemberAdd, runPromotions } from '../src/services/notifications/onboarding.js';
import { addActivity, getCommunityMember } from '../src/services/onboarding.js';
import {
  DEFAULT_WELCOME_MESSAGE,
  isPromotionEligible,
  pickAutomaticRole,
  renderTemplate,
  roleProblem,
  SYSTEM_DEFAULT_ROLE_NAME,
  SYSTEM_PROMOTION_ROLE_NAME,
  unknownPlaceholders,
} from '../src/services/rules/onboarding.js';
import { resetDb } from './helpers.js';
import { BOT_ID, CHANNELS, GUILD_ID, MockFluxer, OWNER_ID, TOKEN, waitFor } from './mockFluxer.js';

const WELCOME = 'c-boas-vindas';
const DAY = 86_400_000;

const role = (id: string, name: string, position: number, permissions = 0n): Role => ({
  id,
  name,
  color: 0,
  position,
  permissions: permissions.toString(),
  hoist: false,
  mentionable: false,
});
const EVERYONE = role(GUILD_ID, '@everyone', 0);
const BOT_ROLE = role('r-bot', 'Bot', 50, Permission.MANAGE_ROLES);

let mock: MockFluxer;
let client: FluxerClient;
let seq = 1;

function memberAdd(id: string, opts: { joinedAt?: string; guildId?: string; bot?: boolean; roles?: string[]; name?: string } = {}) {
  return {
    guild_id: opts.guildId ?? GUILD_ID,
    user: { id, username: opts.name ?? `user${id}`, global_name: null, discriminator: '0000', avatar: null, bot: opts.bot },
    nick: null,
    roles: opts.roles ?? [],
    joined_at: opts.joinedAt ?? '2026-10-01T12:00:00.000Z',
  } satisfies GuildMemberAddEvent;
}

const welcomes = () => mock.callsTo('POST', new RegExp(`^/channels/${WELCOME}/messages$`));
const roleAdds = (userId: string) => mock.callsTo('PUT', new RegExp(`/members/${userId}/roles/`));
const auditActions = async (userId?: string) =>
  (await prisma.auditLog.findMany({ where: userId ? { userId } : {}, orderBy: { id: 'asc' } })).map((a) => a.action);

/** Comando de admin (o dono do servidor) pelo MESSAGE_CREATE, como no chat. */
async function adminSays(content: string) {
  const event: MessageCreateEvent = {
    id: `m${seq++}`,
    channel_id: CHANNELS.comandos,
    guild_id: GUILD_ID,
    channel_type: 0,
    author: { id: OWNER_ID, username: 'dono', global_name: null, discriminator: '0000', avatar: null },
    type: 0,
    content,
    timestamp: new Date().toISOString(),
    mentions: [],
    mention_roles: [],
    embeds: [],
    member: { nick: null, roles: [], joined_at: new Date().toISOString() },
  };
  await onMessageCreate(client, event);
  return waitFor(() => mock.calls.find((c) => c.method === 'POST' && c.body?.message_reference?.message_id === event.id));
}

beforeAll(async () => {
  mock = await new MockFluxer().start();
  mock.strictRoles = true;
  client = await FluxerClient.create(mock.origin, TOKEN, GUILD_ID);
  const ready = new Promise((r) => client.gateway.once('ready', r));
  client.login();
  await ready;
});

afterAll(async () => {
  client.destroy();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  mock.roles = [EVERYONE, BOT_ROLE];
  mock.memberRoles = new Map([[BOT_ID, [BOT_ROLE.id]]]);
  mock.memberJoinedAt.clear();
  mock.dmBlocked.clear();
  mock.calls = [];
  // O cache de cargos do cliente segue o servidor falso.
  client.invalidateRoles();
  await guildSettings.update(GUILD_ID, { welcomeChannelId: WELCOME });
});

describe('regras', () => {
  it('troca os placeholders numa passada só, sem executar nada', () => {
    const text = renderTemplate('Oi {mention} ({displayName}) em {communityName}, membro nº {memberCount}, {role}. {xyz}', {
      mention: '<@1>',
      displayName: '{role}${process.exit()}',
      communityName: 'Crimelândia',
      memberCount: '43',
      role: '🌱 Escudeiro',
    });
    expect(text).toBe('Oi <@1> ({role}${process.exit()}) em Crimelândia, membro nº 43, 🌱 Escudeiro. {xyz}');
    expect(unknownPlaceholders('{username} {foo} {foo}')).toEqual(['foo']);
    expect(renderTemplate('x'.repeat(3000), {})).toHaveLength(2000);
  });

  it('recusa @everyone, cargos administrativos/de moderação e cargos acima do bot', () => {
    expect(roleProblem(undefined, GUILD_ID, 50)).toBe('missing');
    expect(roleProblem(EVERYONE, GUILD_ID, 50)).toBe('everyone');
    expect(roleProblem(role('a', 'Admin', 5, Permission.ADMINISTRATOR), GUILD_ID, 50)).toBe('privileged');
    expect(roleProblem(role('b', 'Mod', 5, 1n << 1n), GUILD_ID, 50)).toBe('privileged'); // KICK_MEMBERS
    expect(roleProblem(role('c', 'Topo', 60), GUILD_ID, 50)).toBe('above_bot');
    expect(roleProblem(role('d', 'Escudeiro', 2, Permission.SEND_MESSAGES | Permission.CONNECT), GUILD_ID, 50)).toBeNull();
  });

  it('cargo configurado excluído ou administrativo cai no cargo do sistema de menor posição', () => {
    const roles = [EVERYONE, role('s2', '🌱┃Escudeiro', 9), role('s1', 'escudeiro', 3), role('adm', 'Admin', 10, Permission.ADMINISTRATOR)];
    expect(pickAutomaticRole(roles, GUILD_ID, 50, 's2', SYSTEM_DEFAULT_ROLE_NAME)).toMatchObject({
      role: { id: 's2' },
      source: 'configured',
    });
    expect(pickAutomaticRole(roles, GUILD_ID, 50, 'excluido', SYSTEM_DEFAULT_ROLE_NAME)).toMatchObject({
      role: { id: 's1' },
      source: 'system',
    });
    expect(pickAutomaticRole(roles, GUILD_ID, 50, 'adm', SYSTEM_DEFAULT_ROLE_NAME)).toMatchObject({ role: { id: 's1' }, source: 'system' });
    expect(pickAutomaticRole([EVERYONE], GUILD_ID, 50, 'excluido', SYSTEM_DEFAULT_ROLE_NAME)).toEqual({
      role: null,
      configuredProblem: 'missing',
    });
    // Um cargo de sistema com permissão de admin também não serve.
    const trap = [EVERYONE, role('t', '🌱 Escudeiro', 3, Permission.MANAGE_GUILD)];
    expect(pickAutomaticRole(trap, GUILD_ID, 50, null, SYSTEM_DEFAULT_ROLE_NAME).role).toBeNull();
  });

  it('promoção exige os dias e a atividade mínimos', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const rules = { minimumDays: 7, minimumActivityPoints: 50 };
    expect(isPromotionEligible(new Date('2026-10-02T00:00:00Z'), 50, rules, now)).toBe(true);
    expect(isPromotionEligible(new Date('2026-10-04T00:00:00Z'), 500, rules, now)).toBe(false);
    expect(isPromotionEligible(new Date('2026-09-01T00:00:00Z'), 49, rules, now)).toBe(false);
  });
});

describe('entrada de membro', () => {
  it('cria a associação, dá o 🌱 Escudeiro (criando o cargo sem permissões) e publica as boas-vindas', async () => {
    const result = await onMemberAdd(client, memberAdd('500', { name: 'aventureiro' }));
    expect(result).toMatchObject({ status: 'first', welcomed: true });

    const created = mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/roles$`));
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject({ name: SYSTEM_DEFAULT_ROLE_NAME, permissions: '0' });
    const escudeiro = mock.roles.find((r) => r.name === SYSTEM_DEFAULT_ROLE_NAME)!;
    expect(mock.memberRoles.get('500')).toEqual([escudeiro.id]);
    expect(roleAdds('500')[0].headers['x-audit-log-reason']).toBe('Cargo inicial automatico (onboarding)');

    const [welcome] = welcomes();
    expect(welcome.body.content).toContain('🏰 **Um novo aventureiro chegou ao Reino!**');
    expect(welcome.body.content).toContain('Seja bem-vindo, <@500>!');
    expect(welcome.body.content).toContain(`Você inicia sua jornada como ${SYSTEM_DEFAULT_ROLE_NAME}.`);
    expect(welcome.body.content).toContain('Que comece sua jornada por Crimelândia.');
    // Só o novo membro é mencionado.
    expect(welcome.body.allowed_mentions).toEqual({ users: ['500'] });

    const member = await getCommunityMember(GUILD_ID, '500');
    expect(member).toMatchObject({ initialRoleId: escudeiro.id, welcomeMessageId: expect.any(String) });
    expect(member?.welcomedAt).toBeInstanceOf(Date);
    expect(await auditActions('500')).toEqual(['member_join', 'role_assigned', 'welcome_sent']);
    expect(await auditActions()).toContain('role_created');
  });

  it('usa o cargo configurado, com mensagem personalizada e placeholders', async () => {
    mock.roles.push(role('r-novato', 'Novato', 2));
    await guildSettings.update(GUILD_ID, {
      defaultMemberRoleId: 'r-novato',
      welcomeMessage: '{displayName} ({username}) é o membro {memberCount} de {communityName} como {role}',
    });
    const before = client.memberCount!;
    client.memberCount = before + 1; // o Gateway soma no GUILD_MEMBER_ADD
    await onMemberAdd(client, { ...memberAdd('501', { name: 'joao' }), nick: 'João' });
    expect(mock.memberRoles.get('501')).toEqual(['r-novato']);
    expect(welcomes()[0].body.content).toBe(`João (joao) é o membro ${before + 1} de Crimelândia como Novato`);
    expect(mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/roles$`))).toHaveLength(0);
  });

  it('cargo padrão excluído: usa o 🌱 Escudeiro que já existe, sem criar outro', async () => {
    mock.roles.push(role('r-esc', SYSTEM_DEFAULT_ROLE_NAME, 3));
    await guildSettings.update(GUILD_ID, { defaultMemberRoleId: 'r-que-foi-excluido' });
    await onMemberAdd(client, memberAdd('502'));
    expect(mock.memberRoles.get('502')).toEqual(['r-esc']);
    expect(mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/roles$`))).toHaveLength(0);
  });

  it('nunca dá um cargo administrativo, mesmo que ele esteja configurado', async () => {
    mock.roles.push(role('8001', 'Conselho', 10, Permission.ADMINISTRATOR), role('r-esc', SYSTEM_DEFAULT_ROLE_NAME, 3));
    // Ex.: o cargo era seguro quando foi configurado e depois ganhou Administrador.
    await guildSettings.update(GUILD_ID, { defaultMemberRoleId: '8001' });
    await onMemberAdd(client, memberAdd('503'));
    expect(mock.memberRoles.get('503')).toEqual(['r-esc']);
    expect(roleAdds('503').some((c) => c.path.endsWith('/8001'))).toBe(false);
  });

  it('!boasvindas cargo recusa cargo administrativo e aceita um cargo comum', async () => {
    mock.roles.push(role('8001', 'Conselho', 10, Permission.ADMINISTRATOR), role('8002', 'Recruta', 4));
    const refused = await adminSays('!boasvindas cargo <@&8001>');
    expect(refused.body.content).toContain('permissões de administração ou moderação');
    expect((await guildSettings.get(GUILD_ID)).defaultMemberRoleId).toBeNull();

    const accepted = await adminSays('!boasvindas cargo <@&8002>');
    expect(accepted.body.content).toContain('<@&8002>');
    expect((await guildSettings.get(GUILD_ID)).defaultMemberRoleId).toBe('8002');
    const log = await prisma.auditLog.findFirst({ where: { action: 'config_changed' } });
    expect(log).toMatchObject({ actorId: OWNER_ID, details: JSON.stringify({ defaultMemberRoleId: '8002' }) });
  });

  it('!boasvindas edita a mensagem, mostra o preview e desativa', async () => {
    await adminSays('!boasvindas mensagem Salve {mention}, bem-vindo a {communityName}! {inexistente}');
    expect((await guildSettings.get(GUILD_ID)).welcomeMessage).toBe('Salve {mention}, bem-vindo a {communityName}! {inexistente}');
    const preview = await adminSays('!boasvindas preview');
    expect(preview.body.content).toContain(`Salve <@${OWNER_ID}>, bem-vindo a Crimelândia! {inexistente}`);
    expect(preview.body.allowed_mentions).toEqual({ parse: [] });

    await adminSays('!boasvindas desativar');
    const result = await onMemberAdd(client, memberAdd('504'));
    expect(result).toMatchObject({ status: 'first', welcomed: false });
    expect(welcomes()).toHaveLength(0);
    expect(mock.memberRoles.get('504')).toHaveLength(1); // o cargo inicial continua

    await adminSays('!boasvindas mensagem padrao');
    expect((await guildSettings.get(GUILD_ID)).welcomeMessage).toBeNull();
    expect(DEFAULT_WELCOME_MESSAGE).toContain('{mention}');
  });

  it('evento repetido (até ao mesmo tempo) gera uma associação, um cargo e uma mensagem só', async () => {
    const event = memberAdd('505');
    const results = await Promise.all([onMemberAdd(client, event), onMemberAdd(client, event), onMemberAdd(client, { ...event })]);
    expect(results.map((r) => r.status).sort()).toEqual(['duplicate', 'duplicate', 'first']);
    expect(await prisma.communityMember.count({ where: { userId: '505' } })).toBe(1);
    expect(roleAdds('505')).toHaveLength(1);
    expect(welcomes()).toHaveLength(1);
    expect(await auditActions('505')).toEqual(['member_join', 'role_assigned', 'welcome_sent']);
  });

  it('quem sai e volta recebe o cargo de novo, mas não as boas-vindas', async () => {
    await onMemberAdd(client, memberAdd('506', { joinedAt: '2026-10-01T10:00:00.000Z' }));
    mock.memberRoles.delete('506'); // saiu: o Fluxer tira os cargos
    const again = await onMemberAdd(client, memberAdd('506', { joinedAt: '2026-10-03T10:00:00.000Z' }));
    expect(again).toMatchObject({ status: 'rejoin', welcomed: false });
    expect(mock.memberRoles.get('506')).toHaveLength(1);
    expect(welcomes()).toHaveLength(1);
    expect(await auditActions('506')).toEqual(['member_join', 'role_assigned', 'welcome_sent', 'member_rejoin', 'role_assigned']);
  });

  it('sem canal de boas-vindas: registra welcome_failed (e o cargo inicial continua)', async () => {
    await guildSettings.update(GUILD_ID, { welcomeChannelId: null });
    const result = await onMemberAdd(client, memberAdd('512'));
    expect(result).toMatchObject({ status: 'first', roleId: expect.any(String) });
    const failed = await prisma.auditLog.findFirst({ where: { userId: '512', action: 'welcome_failed' } });
    expect(JSON.parse(failed!.details!)).toMatchObject({ reason: 'no_channel' });
  });

  it('ignora bots e eventos de outra comunidade (sem tocar em nada)', async () => {
    expect(await onMemberAdd(client, memberAdd('507', { bot: true }))).toEqual({ status: 'ignored', reason: 'bot' });
    expect(await onMemberAdd(client, memberAdd('508', { guildId: 'outra-comunidade' }))).toEqual({
      status: 'ignored',
      reason: 'other_guild',
    });
    expect(mock.calls).toHaveLength(0);
    expect(await prisma.communityMember.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('DM de boas-vindas: entrega quando ativada e não quebra quando a DM está fechada', async () => {
    await guildSettings.update(GUILD_ID, { welcomeDMEnabled: true });
    await onMemberAdd(client, memberAdd('509'));
    expect(mock.callsTo('POST', /^\/users\/@me\/channels$/)[0].body).toEqual({ recipient_id: '509' });
    expect(mock.callsTo('POST', /^\/channels\/dm-509\/messages$/)).toHaveLength(1);

    mock.dmBlocked.add('510');
    const result = await onMemberAdd(client, memberAdd('510'));
    expect(result).toMatchObject({ status: 'first', welcomed: true });
    const sent = await prisma.auditLog.findFirst({ where: { userId: '510', action: 'welcome_sent' } });
    expect(JSON.parse(sent!.details!)).toMatchObject({ channelId: WELCOME, dm: false });
  });

  it('se o Fluxer recusar o cargo, registra no histórico e ainda dá as boas-vindas', async () => {
    mock.roles.push(role('r-esc', SYSTEM_DEFAULT_ROLE_NAME, 3));
    const original = mock.roles;
    // O cargo some entre a leitura e a atribuição.
    mock.memberRoles.set(BOT_ID, [BOT_ROLE.id]);
    const getRoles = client.getRoles.bind(client);
    client.getRoles = async () => {
      const roles = await getRoles();
      mock.roles = original.filter((r) => r.id !== 'r-esc');
      return roles;
    };
    try {
      const result = await onMemberAdd(client, memberAdd('511'));
      expect(result).toMatchObject({ status: 'first', roleId: null, welcomed: true });
      expect(await auditActions('511')).toEqual(['member_join', 'role_missing', 'welcome_sent']);
    } finally {
      client.getRoles = getRoles;
    }
  });
});

describe('isolamento entre comunidades', () => {
  it('configuração, membros e atividade de uma comunidade não vazam para outra', async () => {
    await guildSettings.update('outra-comunidade', { welcomeEnabled: false, defaultMemberRoleId: 'r-de-la' });
    await addActivity('outra-comunidade', '600', 999);
    await onMemberAdd(client, memberAdd('600'));
    // Aqui o 600 é novo (a linha da outra comunidade não conta como entrada anterior).
    expect(welcomes()).toHaveLength(1);
    expect(mock.memberRoles.get('600')?.[0]).not.toBe('r-de-la');
    expect((await getCommunityMember(GUILD_ID, '600'))?.activityPoints).toBe(0);
    expect((await getCommunityMember('outra-comunidade', '600'))?.activityPoints).toBe(999);
  });
});

describe('progressão Escudeiro → Mercenário', () => {
  async function enable(days = 7, points = 10) {
    await adminSays('!progressao ativar');
    await adminSays(`!progressao dias ${days}`);
    await adminSays(`!progressao atividade ${points}`);
  }

  it('atividade das missões soma pontos (mensagem 1, partida 5, minutos de voz 1/min)', async () => {
    await trackMission(client, { id: '700', username: 'ativo' }, 'send_messages');
    await trackMission(client, '700', 'play_matches');
    await trackMission(client, '700', 'voice_minutes', 3);
    await trackMission(client, '700', 'win_duels');
    expect((await getCommunityMember(GUILD_ID, '700'))?.activityPoints).toBe(9);
  });

  it('promove quem tem os dias e os pontos, troca os cargos, anuncia e registra uma vez só', async () => {
    await enable();
    const escudeiro = mock.roles.find((r) => r.name === SYSTEM_DEFAULT_ROLE_NAME)!;
    const mercenario = mock.roles.find((r) => r.name === SYSTEM_PROMOTION_ROLE_NAME)!;
    expect(BigInt(mercenario.permissions)).toBe(0n);

    for (const [id, days, points] of [
      ['701', 8, 12], // promove
      ['702', 3, 500], // poucos dias
      ['703', 30, 5], // pouca atividade
    ] as const) {
      await onMemberAdd(client, memberAdd(id, { joinedAt: new Date(Date.now() - days * DAY).toISOString() }));
      mock.memberJoinedAt.set(id, new Date(Date.now() - days * DAY).toISOString());
      await addActivity(GUILD_ID, id, points);
    }
    mock.calls = [];

    const run = await runPromotions(client);
    expect(run.promoted).toEqual(['701']);
    expect(mock.memberRoles.get('701')).toEqual([mercenario.id]);
    expect(mock.memberRoles.get('702')).toEqual([escudeiro.id]);
    const announce = welcomes().find((c) => c.body.content.includes('Uma nova jornada começa'))!;
    expect(announce.body.content).toBe(
      `⚔️ **Uma nova jornada começa!**\n<@701> deixou de ser ${SYSTEM_DEFAULT_ROLE_NAME} e agora faz parte dos ${SYSTEM_PROMOTION_ROLE_NAME} do Reino.`,
    );
    expect(await prisma.auditLog.count({ where: { action: 'member_promoted', userId: '701' } })).toBe(1);

    // Rodar de novo não promove nem anuncia outra vez.
    mock.calls = [];
    expect((await runPromotions(client)).promoted).toEqual([]);
    expect(mock.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('desativada (padrão) não promove ninguém; cargo administrativo como promoção é recusado', async () => {
    await onMemberAdd(client, memberAdd('704', { joinedAt: new Date(Date.now() - 30 * DAY).toISOString() }));
    await addActivity(GUILD_ID, '704', 1000);
    expect(await runPromotions(client)).toEqual({ promoted: [], skipped: 'disabled' });

    mock.roles.push(role('8003', 'Guarda', 9, Permission.MANAGE_MESSAGES));
    const refused = await adminSays('!progressao cargo <@&8003>');
    expect(refused.body.content).toContain('permissões de administração ou moderação');
  });

  it('!progressao mostra o progresso do membro', async () => {
    await addActivity(GUILD_ID, OWNER_ID, 12);
    const reply = await adminSays('!progressao');
    expect(reply.body.embeds[0].description).toContain('12 / 50 pontos');
  });
});
