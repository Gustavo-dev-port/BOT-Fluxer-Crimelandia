/**
 * Teste ponta a ponta: o bot real (FluxerClient + handlers) contra um
 * servidor Fluxer falso que segue docs.fluxer.app.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { onMessageCreate } from '../src/events/messageCreate.js';
import { onReaction } from '../src/events/reactions.js';
import { onVoiceEvent } from '../src/events/voiceState.js';
import { trackVoice } from '../src/services/notifications/missionTracker.js';
import { trackRooms } from '../src/services/notifications/voiceRooms.js';
import { todayKey } from '../src/services/missions.js';
import { prisma } from '../src/database/client.js';
import { FluxerClient } from '../src/fluxer/client.js';
import { RestClient } from '../src/fluxer/rest.js';
import type { MessageCreateEvent, ReactionEvent } from '../src/fluxer/types.js';
import { seedDefaultGames } from '../src/services/games.js';
import { getRanking } from '../src/services/ranking.js';
import { getActiveSeason } from '../src/services/seasons.js';
import { resetDb } from './helpers.js';
import { BOT_ID, CHANNELS, GUILD_ID, MockFluxer, OWNER_ID, TOKEN, waitFor } from './mockFluxer.js';

let mock: MockFluxer;
let client: FluxerClient;
let msgSeq = 1;

const user = (id: string, name: string) => ({
  id,
  username: name,
  global_name: null,
  discriminator: '0000',
  avatar: null as string | null,
});
const GUSTAVO = user('100', 'gustavo');
const LUCAS = user('200', 'lucas');
const CURIOSO = user('300', 'curioso');

/** Simula um membro digitando no #comandos. */
function say(author: ReturnType<typeof user>, content: string, mentions: ReturnType<typeof user>[] = [], roles: string[] = []) {
  const event: MessageCreateEvent = {
    id: `m${msgSeq++}`,
    channel_id: CHANNELS.comandos,
    guild_id: GUILD_ID,
    channel_type: 0,
    author,
    type: 0,
    content,
    timestamp: new Date().toISOString(),
    mentions,
    mention_roles: [],
    embeds: [],
    member: { nick: null, roles, joined_at: new Date().toISOString() },
  };
  mock.dispatch('MESSAGE_CREATE', event);
  return event;
}

function react(u: ReturnType<typeof user>, messageId: string, emoji: string, channelId = CHANNELS.comandos) {
  mock.dispatch('MESSAGE_REACTION_ADD', {
    user_id: u.id,
    channel_id: channelId,
    message_id: messageId,
    guild_id: GUILD_ID,
    emoji: { name: emoji },
    member: { user: u, roles: [], nick: null, joined_at: new Date().toISOString() },
  } satisfies ReactionEvent);
}

/** Espera uma condição assíncrona (consultas ao banco). */
async function until(fn: () => Promise<boolean>, timeout = 3000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error('until: tempo esgotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Reage a um prompt de partida só depois de o bot registrá-lo. O bot envia a mensagem
 * e em seguida grava o prompt; uma pessoa só consegue reagir depois (os botões ✅/❌
 * aparecem depois do registro), mas o teste reagiria no meio.
 */
async function reactToPrompt(u: ReturnType<typeof user>, messageId: string, emoji: string) {
  await until(async () => Boolean(await prisma.reactionPrompt.findUnique({ where: { messageId } })));
  react(u, messageId, emoji);
}

/** Última resposta do bot a uma mensagem específica. */
function replyTo(event: MessageCreateEvent) {
  return mock.calls.find((c) => c.method === 'POST' && c.body?.message_reference?.message_id === event.id);
}

beforeAll(async () => {
  mock = await new MockFluxer().start();
  client = await FluxerClient.create(mock.origin, TOKEN, GUILD_ID);
  client.gateway.on('dispatch', (event, data) => {
    if (event === 'MESSAGE_CREATE') void onMessageCreate(client, data as MessageCreateEvent);
    if (event === 'MESSAGE_REACTION_ADD') void onReaction(client, data as ReactionEvent, true);
    if (event === 'MESSAGE_REACTION_REMOVE') void onReaction(client, data as ReactionEvent, false);
    onVoiceEvent(client, event, data);
  });
  trackVoice(client);
  trackRooms(client);
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
  await seedDefaultGames();
  mock.calls = [];
});

afterEach(() => {
  mock.rateLimitNext = 0;
});

describe('Gateway', () => {
  it('faz Identify com o token cru (sem "Bot ") e as propriedades obrigatórias', () => {
    const identify = mock.gatewayFrames.find((f) => f.op === 2);
    expect(identify.d.token).toBe(TOKEN);
    expect(identify.d.properties).toMatchObject({ os: expect.any(String), browser: expect.any(String), device: expect.any(String) });
    expect(identify.d).not.toHaveProperty('intents');
    expect(client.botId).toBe(BOT_ID);
  });

  it('reconecta com Resume (session_id + seq) quando o servidor fecha com 4000', async () => {
    const before = mock.gatewayFrames.filter((f) => f.op === 6).length;
    mock.closeLatest(4000, 'Session drain requested; reconnect to continue');
    const resume = await waitFor(() => mock.gatewayFrames.filter((f) => f.op === 6)[before], 8000);
    expect(resume.d).toMatchObject({ token: TOKEN, session_id: mock.sessionId, seq: expect.any(Number) });
  }, 10_000);
});

describe('REST', () => {
  it('usa Authorization: Bot <token> e respeita 429 com retry_after', async () => {
    const rest = new RestClient(`${mock.origin}/api`, TOKEN);
    mock.rateLimitNext = 2;
    const msg = await rest.sendMessage('c-x', { content: 'oi' });
    expect(msg.content).toBe('oi');
    const posts = mock.callsTo('POST', /^\/channels\/c-x\/messages$/);
    expect(posts).toHaveLength(3); // 2 negadas + 1 aceita
    expect(posts[0].headers.authorization).toBe(`Bot ${TOKEN}`);
  });
});

describe('comandos e reações', () => {
  it('duelo completo: !duelo → ✅ aceita → !resultado → ✅ confirma → ranking, #partidas e #placar', async () => {
    const cmd = say(GUSTAVO, '!duelo <@200> cs2', [LUCAS]);
    const challenge = await waitFor(() => replyTo(cmd)?.response);
    expect(challenge.embeds[0].title).toMatch(/Desafio #\d+ — CS2/);
    expect(challenge.content).toBe('<@200>');

    // O bot põe ✅ e ❌ como "botões".
    await waitFor(() => mock.callsTo('PUT', new RegExp(`/messages/${challenge.id}/reactions/.+/@me$`)).length === 2);
    const emojis = mock
      .callsTo('PUT', new RegExp(`/messages/${challenge.id}/reactions/`))
      .map((c) => decodeURIComponent(c.path.split('/')[6]));
    expect(emojis).toEqual(['✅', '❌']);

    // Quem não participa não consegue aceitar.
    await reactToPrompt(CURIOSO, challenge.id, '✅');
    // Lucas aceita reagindo: o bot edita a mensagem do desafio.
    await reactToPrompt(LUCAS, challenge.id, '✅');
    const accepted = await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${challenge.id}$`))[0]);
    expect(accepted.body.embeds[0].title).toMatch(/aceita/);

    const report = say(GUSTAVO, '!resultado <@100>', [GUSTAVO]);
    const awaiting = await waitFor(() => replyTo(report)?.response);
    expect(awaiting.embeds[0].title).toMatch(/Resultado informado/);
    expect(awaiting.content).toBe('<@200>');

    // Gustavo não pode confirmar o próprio resultado: recebe aviso no canal.
    await reactToPrompt(GUSTAVO, awaiting.id, '✅');
    await waitFor(() => mock.calls.find((c) => c.method === 'POST' && /<@100> ❌/.test(c.body?.content ?? '')));

    // Lucas confirma com ✅ (o Fluxer pode mandar ⚠️/✅ com ou sem U+FE0F).
    await reactToPrompt(LUCAS, awaiting.id, '✅️');
    const confirmed = await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${awaiting.id}$`))[0]);
    expect(confirmed.body.embeds[0].title).toMatch(/✅ Partida #\d+/);

    // Histórico em #partidas e placar criado + fixado em #placar.
    await waitFor(() => mock.callsTo('POST', new RegExp(`^/channels/${CHANNELS.partidas}/messages$`))[0]);
    const board = await waitFor(() => mock.callsTo('POST', new RegExp(`^/channels/${CHANNELS.placar}/messages$`))[0]?.response);
    await waitFor(() => mock.callsTo('PUT', new RegExp(`^/channels/${CHANNELS.placar}/pins/${board.id}$`))[0]);

    const season = await getActiveSeason();
    const ranking = await getRanking(prisma, season.id);
    expect(ranking.map((r) => [r.playerId, r.rating])).toEqual([
      ['100', 1016],
      ['200', 984],
    ]);
    const curioso = mock.calls.find((c) => c.method === 'POST' && /<@300>/.test(c.body?.content ?? ''));
    expect(curioso).toBeUndefined();
  });

  it('❌ recusa o desafio', async () => {
    const cmd = say(GUSTAVO, '!x1 <@200> Valorant', [LUCAS]);
    const challenge = await waitFor(() => replyTo(cmd)?.response);
    await reactToPrompt(LUCAS, challenge.id, '❌');
    const edited = await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${challenge.id}$`))[0]);
    expect(edited.body.embeds[0].title).toMatch(/recusado/);
  });

  it('responde erros de uso e comandos de admin só para admins', async () => {
    const noGame = say(GUSTAVO, '!duelo <@200>', [LUCAS]);
    expect((await waitFor(() => replyTo(noGame))).body.content).toMatch(/Informe o jogo/);

    const denied = say(GUSTAVO, '!admin placar');
    expect((await waitFor(() => replyTo(denied))).body.content).toMatch(/Apenas admins/);

    // O dono do servidor tem todas as permissões.
    const owner = say(user(OWNER_ID, 'dono'), '!admin placar');
    expect((await waitFor(() => replyTo(owner))).body.content).toMatch(/Placar atualizado/);
  });

  it('cargo com Gerenciar Servidor conta como admin', async () => {
    mock.roles.push({ id: 'r-mod', name: 'Mod', color: 0, position: 1, permissions: String(1n << 5n), hoist: false, mentionable: false });
    // Força o bot a buscar os cargos de novo.
    mock.dispatch('GUILD_ROLE_CREATE', { guild_id: GUILD_ID, role: mock.roles.at(-1) });
    await new Promise((r) => setTimeout(r, 50));
    // O evento de mensagem já traz os cargos do autor em `member.roles`.
    const ev = say(GUSTAVO, '!admin placar', [], ['r-mod']);
    expect((await waitFor(() => replyTo(ev))).body.content).toMatch(/Placar atualizado/);
    mock.roles.pop();
  });

  it('!ajuda lista os comandos por categoria', async () => {
    const ev = say(GUSTAVO, '!ajuda');
    const reply = await waitFor(() => replyTo(ev));
    expect(reply.body.embeds[0].fields.map((f: any) => f.name)).toEqual([
      'Duelos',
      'Ranking',
      'Times e campeonatos',
      'Economia',
      'Música',
      'Promoções',
      'Administração',
    ]);
    const one = say(GUSTAVO, '!ajuda rival');
    expect((await waitFor(() => replyTo(one))).body.embeds[0].title).toContain('!rival');
  });

  it('ignora mensagens de bots, de outros servidores e sem prefixo', async () => {
    mock.dispatch('MESSAGE_CREATE', { ...say(GUSTAVO, 'oi pessoal'), id: 'x1' });
    mock.dispatch('MESSAGE_CREATE', {
      id: 'x2',
      channel_id: 'c',
      guild_id: 'outro',
      channel_type: 0,
      author: GUSTAVO,
      type: 0,
      content: '!ajuda',
      timestamp: '',
      mentions: [],
      mention_roles: [],
      embeds: [],
    });
    mock.dispatch('MESSAGE_CREATE', {
      id: 'x3',
      channel_id: 'c',
      guild_id: GUILD_ID,
      channel_type: 0,
      author: { ...LUCAS, bot: true },
      type: 0,
      content: '!ajuda',
      timestamp: '',
      mentions: [],
      mention_roles: [],
      embeds: [],
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(mock.callsTo('POST', /\/messages$/)).toHaveLength(0);
  });

  it('campeonato: anúncio em #eventos com ✅, inscrição por reação e início pelo admin', async () => {
    const create = say(user(OWNER_ID, 'dono'), '!campeonato criar "Copa Teste" CS2 mata-mata');
    await waitFor(() => replyTo(create));
    const announce = await waitFor(() => mock.callsTo('POST', new RegExp(`^/channels/${CHANNELS.eventos}/messages$`))[0]?.response);
    await waitFor(() => mock.callsTo('PUT', new RegExp(`/messages/${announce.id}/reactions/`))[0]);

    for (const u of [GUSTAVO, LUCAS]) react(u, announce.id, '✅', CHANNELS.eventos);
    const t = await prisma.tournament.findFirstOrThrow();
    await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${announce.id}$`)).length >= 2);
    expect(await prisma.tournamentEntry.count({ where: { tournamentId: t.id } })).toBe(2);

    const start = say(user(OWNER_ID, 'dono'), `!campeonato iniciar ${t.id}`);
    expect((await waitFor(() => replyTo(start))).body.content).toMatch(/começou/);
    const liberadas = await waitFor(() => mock.sentWithTitle(/partidas liberadas/)[0]);
    expect(liberadas.body.content).toMatch(/<@100>/);
  });

  it('!config: só admin; define canal e cargo; mostra a configuração', async () => {
    const denied = say(GUSTAVO, `!config promo <#${CHANNELS['💸┃promocoes']}>`);
    expect((await waitFor(() => replyTo(denied))).body.content).toMatch(/Apenas admins/);

    const dono = user(OWNER_ID, 'dono');
    const setPromo = say(dono, `!config promo <#${CHANNELS['💸┃promocoes']}>`);
    expect((await waitFor(() => replyTo(setPromo))).body.content).toMatch(/Promoções.*<#7770001>/);

    const badChannel = say(dono, '!config promo <#nao-existe>');
    expect((await waitFor(() => replyTo(badChannel))).body.content).toMatch(/Mencione o canal|não existe/);

    mock.roles.push({
      id: '8880001',
      name: 'Caçadores de Promoção',
      color: 0,
      position: 1,
      permissions: '0',
      hoist: false,
      mentionable: true,
    });
    mock.dispatch('GUILD_ROLE_CREATE', { guild_id: GUILD_ID, role: mock.roles.at(-1) });
    await new Promise((r) => setTimeout(r, 50));
    const setRole = say(dono, '!config promo-role <@&8880001>');
    expect((await waitFor(() => replyTo(setRole))).body.content).toMatch(/<@&8880001>/);

    const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: GUILD_ID } });
    expect(settings).toMatchObject({ promoChannelId: '7770001', promoRoleId: '8880001', language: 'pt-BR' });

    const show = say(dono, '!config');
    const embed = (await waitFor(() => replyTo(show))).body.embeds[0];
    expect(embed.fields[0].value).toContain('<#7770001>');
    expect(embed.fields[1].value).toContain('<@&8880001>');

    const clear = say(dono, '!config promo limpar');
    await waitFor(() => replyTo(clear));
    expect((await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: GUILD_ID } })).promoChannelId).toBeNull();
    mock.roles.pop();
  });

  it('!setup encontra os canais pelo nome e cria o cargo 🏆 Campeão do Reino', async () => {
    const ev = say(user(OWNER_ID, 'dono'), '!setup');
    const reply = await waitFor(() => replyTo(ev));
    expect(reply.body.content).toMatch(/encontrado <#c-comandos>/);
    const created = mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/roles$`))[0];
    expect(created.body.name).toBe('🏆 Campeão do Reino');
    const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: GUILD_ID } });
    expect(settings).toMatchObject({ commandsChannelId: 'c-comandos', scoreboardChannelId: 'c-placar', eventChannelId: 'c-eventos' });
    expect(settings.championRoleId).toMatch(/^r/);
    // #hall-do-reino não existia: é criado só leitura para @everyone.
    const hallChannel = mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/channels$`)).find((c) => /hall-do-reino/.test(c.body.name));
    expect(hallChannel!.body.name).toBe('🏰┃hall-do-reino');
    expect(hallChannel!.body.permission_overwrites[0]).toMatchObject({ id: GUILD_ID, deny: expect.any(String) });
    expect(settings.hallChannelId).toMatch(/^c\d+$/);
    mock.roles = mock.roles.filter((r) => r.id === GUILD_ID);
  });

  it('promoções: publica no canal configurado, menciona o cargo em ≥80% e edita quando o preço muda', async () => {
    const { FluxerPromotionPublisher } = await import('../src/services/notifications/promotionPublisher.js');
    const { PromotionService } = await import('../src/services/promotions/promotionService.js');
    const { PromotionRepository } = await import('../src/database/promotionRepository.js');
    await prisma.guildSettings.create({ data: { guildId: GUILD_ID, promoChannelId: '7770001', promoRoleId: '8880002' } });

    const base = {
      platform: 'Steam',
      image: 'https://img/x.jpg',
      currency: 'BRL',
      expiresAt: null,
      url: 'https://store.steampowered.com/app/1/',
    };
    let offers = [
      { ...base, id: 'steam:1', title: 'Hollow Knight', oldPrice: 4699, currentPrice: 704, discount: 85 },
      { ...base, id: 'steam:2', title: 'Celeste', oldPrice: 3699, currentPrice: 1849, discount: 50 },
    ];
    const adapter = { name: 'fake', fetchOffers: async () => offers };
    const svc = new PromotionService(
      [adapter],
      new PromotionRepository(),
      new FluxerPromotionPublisher(client),
      { minDiscount: 40, maxPostsPerRun: 10, staleDays: 3 },
      { info: () => undefined, warn: () => undefined },
    );
    await svc.sync();

    const posts = mock.callsTo('POST', /^\/channels\/7770001\/messages$/);
    expect(posts).toHaveLength(2);
    const [hk, celeste] = posts;
    expect(hk.body.content).toContain('<@&8880002>');
    expect(hk.body.allowed_mentions).toEqual({ roles: ['8880002'] });
    expect(hk.body.embeds[0].title).toBe('🟢 NOVA PROMOÇÃO');
    expect(celeste.body.content).toBeUndefined(); // 50%: sem menção
    expect(celeste.body.allowed_mentions).toEqual({ parse: [] });

    offers = [{ ...offers[0], currentPrice: 469, discount: 90 }, offers[1]];
    await svc.sync();
    const edit = mock.callsTo('PATCH', new RegExp(`^/channels/7770001/messages/${hk.response.id}$`))[0];
    expect(edit.body.embeds[0].title).toBe('🔄 PREÇO ATUALIZADO');
    expect(mock.callsTo('POST', /^\/channels\/7770001\/messages$/)).toHaveLength(2); // nada repostado

    const list = say(GUSTAVO, '!promocoes');
    const reply = await waitFor(() => replyTo(list));
    expect(reply.body.embeds[0].description.split('\n')[0]).toContain('-90%');

    const denied = say(GUSTAVO, '!promocoes atualizar');
    expect((await waitFor(() => replyTo(denied))).body.content).toMatch(/Apenas admins/);
  });

  it('jogos grátis: publica no canal configurado e !gratis lista os ativos', async () => {
    const { FluxerFreeGamePublisher } = await import('../src/services/notifications/freeGamePublisher.js');
    const { FreeGameService } = await import('../src/services/freeGames/freeGameService.js');
    const { FreeGameRepository } = await import('../src/database/freeGameRepository.js');
    await prisma.guildSettings.create({ data: { guildId: GUILD_ID, freeGamesChannelId: '7770002' } });
    const endsAt = new Date(Date.now() + 3 * 86_400_000);
    const source = {
      name: 'fake',
      fetchFreeGames: async () => [
        {
          id: 'epic:1',
          title: 'Death Stranding',
          platform: 'Epic Games',
          kind: 'free' as const,
          description: 'Kojima.',
          image: 'https://img/ds.jpg',
          url: 'https://store.epicgames.com/p/ds',
          startsAt: null,
          endsAt,
        },
      ],
    };
    const svc = new FreeGameService(
      [source],
      new FreeGameRepository(),
      new FluxerFreeGamePublisher(client),
      { maxPostsPerRun: 10, staleDays: 2 },
      { info: () => undefined, warn: () => undefined },
    );
    await svc.sync();
    await svc.sync();
    const posts = mock.callsTo('POST', /^\/channels\/7770002\/messages$/);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.embeds[0]).toMatchObject({ title: '🎁 JOGO GRÁTIS', image: { url: 'https://img/ds.jpg' } });
    expect(posts[0].body.embeds[0].description).toContain('[Resgatar](https://store.epicgames.com/p/ds)');

    const list = say(GUSTAVO, '!gratis');
    expect((await waitFor(() => replyTo(list))).body.embeds[0].description).toContain('Death Stranding');
  });

  it('etapa 4: !resultado com duração, !evento e !resgatar (apelido especial e VIP temporário)', async () => {
    // Duelo com duração informada.
    const d = say(GUSTAVO, '!duelo <@200> CS2', [LUCAS]);
    const challenge = await waitFor(() => replyTo(d)?.response);
    await reactToPrompt(LUCAS, challenge.id, '✅');
    await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${challenge.id}$`))[0]);
    const r = say(GUSTAVO, '!resultado <@100> 25min', [GUSTAVO]);
    const awaiting = await waitFor(() => replyTo(r)?.response);
    await reactToPrompt(LUCAS, awaiting.id, '✅');
    const done = await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${awaiting.id}$`))[0]);
    expect(done.body.embeds[0].description).toContain('Duração: **25 min**');

    // !evento é o mesmo comando de campeonatos.
    const ev = say(GUSTAVO, '!evento listar');
    expect((await waitFor(() => replyTo(ev))).body.embeds[0].title).toContain('Campeonatos');

    // Apelido especial: valida antes de cobrar, aplica o apelido e devolve o original depois.
    await prisma.player.update({ where: { id: '100' }, data: { coins: 1000 } });
    const empty = say(GUSTAVO, '!resgatar apelido-especial');
    expect((await waitFor(() => replyTo(empty))).body.content).toMatch(/Informe o apelido/);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: '100' } })).coins).toBe(1000);

    const nick = say(GUSTAVO, '!resgatar apelido-especial Rei do Clutch');
    expect((await waitFor(() => replyTo(nick))).body.content).toContain('✨ Rei do Clutch');
    const patch = mock.callsTo('PATCH', new RegExp(`^/guilds/${GUILD_ID}/members/100$`))[0];
    expect(patch.body).toEqual({ nick: '✨ Rei do Clutch' });
    expect((await prisma.player.findUniqueOrThrow({ where: { id: '100' } })).coins).toBe(700);

    const { restoreExpiredNicknames } = await import('../src/schedulers/maintenanceScheduler.js');
    await restoreExpiredNicknames(client, new Date(Date.now() + 8 * 86_400_000));
    const restore = mock.callsTo('PATCH', new RegExp(`^/guilds/${GUILD_ID}/members/100$`))[1];
    expect(restore.body).toEqual({ nick: null }); // não tinha apelido antes
    expect(await prisma.tempNickname.count()).toBe(0);

    // VIP agora é temporário.
    process.env.SHOP_VIP_ROLE_ID = '9990001';
    const vip = say(GUSTAVO, '!resgatar cargo-vip');
    expect((await waitFor(() => replyTo(vip))).body.content).toContain('<@&9990001> até');
    expect(mock.callsTo('PUT', new RegExp(`^/guilds/${GUILD_ID}/members/100/roles/9990001$`))).toHaveLength(1);
    expect(await prisma.tempRole.findFirstOrThrow({ where: { playerId: '100', roleId: '9990001' } })).toMatchObject({ deleteRole: false });
    delete process.env.SHOP_VIP_ROLE_ID;
  });

  it('v1.1: Hall do Reino fixado e atualizado, !hall, perfil medieval, !rival com histórico e !rivalidades', async () => {
    const { acceptDuel, confirmResult, createDuel, reportResult } = await import('../src/services/matches.js');
    const { updateHallOfFame } = await import('../src/services/notifications/hallAnnouncer.js');
    const { guildSettings } = await import('../src/database/guildSettingsRepository.js');
    for (const [w, l] of [
      ['100', '200'],
      ['200', '100'],
      ['100', '200'],
    ]) {
      const m = await createDuel({ id: w, username: w }, { id: l, username: l }, 'CS2');
      await acceptDuel(l, m.id);
      await reportResult(w, w, m.id);
      await confirmResult(l, m.id);
    }

    // Mensagem fixada no #hall-do-reino: cria e fixa na primeira vez, edita nas seguintes.
    await guildSettings.setChannel(GUILD_ID, 'hall', 'c-hall');
    await updateHallOfFame(client);
    const posted = mock.callsTo('POST', /^\/channels\/c-hall\/messages$/);
    expect(posted).toHaveLength(1);
    expect(posted[0].body.embeds[0].title).toBe('🏰 Hall do Reino');
    expect(mock.callsTo('PUT', new RegExp(`^/channels/c-hall/pins/${posted[0].response.id}$`))).toHaveLength(1);
    await updateHallOfFame(client);
    expect(mock.callsTo('POST', /^\/channels\/c-hall\/messages$/)).toHaveLength(1);
    expect(mock.callsTo('PATCH', new RegExp(`^/channels/c-hall/messages/${posted[0].response.id}$`))).toHaveLength(1);

    const h = say(GUSTAVO, '!hall');
    const hallReply = await waitFor(() => replyTo(h)?.body);
    const mvp = hallReply.embeds[0].fields.find((f: { name: string }) => f.name.includes('MVP'));
    expect(mvp.value).toContain('<@100>');

    // Perfil com avatar (Media Proxy), classe, liga e títulos.
    const withAvatar = { ...GUSTAVO, avatar: 'abc123' };
    const pf = say(withAvatar, '!perfil');
    const profile = await waitFor(() => replyTo(pf)?.body.embeds[0]);
    expect(profile.thumbnail.url).toBe(`${mock.origin}/avatars/100/abc123.png?size=256`);
    expect(profile.description).toMatch(/Recruta/);
    expect(profile.fields.find((f: { name: string }) => f.name === 'Títulos').value).toMatch(/🔒 Gladiador — .* 3\/50/);

    const rv = say(GUSTAVO, '!rival');
    const rivalEmbed = await waitFor(() => replyTo(rv)?.body.embeds[0]);
    expect(rivalEmbed.fields[0].name).toBe('Histórico');
    expect(rivalEmbed.fields[0].value.split('\n')).toHaveLength(3);

    const top = say(GUSTAVO, '!rivalidades');
    const topEmbed = await waitFor(() => replyTo(top)?.body.embeds[0]);
    expect(topEmbed.description).toContain('<@100> **2** × **1** <@200> — 3 duelos');
  });

  it('etapa 6: missões por mensagem, voz e partida; aviso em #comandos; !missoes e !coletar', async () => {
    const date = todayKey();
    for (const [kind, target, reward] of [
      ['send_messages', 1, 20],
      ['join_voice', 1, 30],
      ['win_duels', 1, 60],
    ] as const) {
      await prisma.dailyMission.create({ data: { date, kind, target, reward } });
    }
    const JOAO = user('400', 'joao');
    const announced = (who: string) =>
      mock
        .callsTo('POST', new RegExp(`^/channels/${CHANNELS.comandos}/messages$`))
        .filter((c) => c.body.content?.startsWith(`🎯 <@${who}>`));

    // Comandos e mensagens curtas não contam; uma mensagem normal conclui a missão.
    say(JOAO, '!ajuda');
    say(JOAO, 'ok');
    say(JOAO, 'boa noite, reino!');
    const msgDone = await waitFor(() => announced('400')[0]);
    expect(msgDone.body.content).toContain('Envie 1 mensagens no servidor');
    expect(msgDone.body.allowed_mentions).toEqual({ users: ['400'] });

    // Entrar numa sala de voz (VOICE_STATE_UPDATE) conclui "Entre em 1 salas".
    mock.dispatch('VOICE_STATE_UPDATE', { guild_id: GUILD_ID, channel_id: 'voz-1', user_id: '400', member: { user: JOAO, roles: [] } });
    await waitFor(() => announced('400').length === 2);
    // Sair e mudar mute não geram nada novo; bots são ignorados.
    mock.dispatch('VOICE_STATE_UPDATE', { guild_id: GUILD_ID, channel_id: null, user_id: '400', member: { user: JOAO, roles: [] } });
    mock.dispatch('VOICE_STATE_UPDATE', {
      guild_id: GUILD_ID,
      channel_id: 'voz-1',
      user_id: '1',
      member: { user: { ...user('1', 'bot'), bot: true }, roles: [] },
    });

    // Vitória confirmada conclui "Vença 1 partida".
    const d = say(JOAO, '!duelo <@200> CS2', [LUCAS]);
    const challenge = await waitFor(() => replyTo(d)?.response);
    await reactToPrompt(LUCAS, challenge.id, '✅');
    await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${challenge.id}$`))[0]);
    const r = say(JOAO, '!resultado <@400>', [JOAO]);
    const awaiting = await waitFor(() => replyTo(r)?.response);
    await reactToPrompt(LUCAS, awaiting.id, '✅');
    await waitFor(() => announced('400').length === 3);

    const m = say(JOAO, '!missoes');
    const list = await waitFor(() => replyTo(m)?.body.embeds[0]);
    expect(list.title).toBe('📜 Missões do dia');
    expect(list.description.match(/pronta/g)).toHaveLength(3);

    const c = say(JOAO, '!coletar');
    const paid = await waitFor(() => replyTo(c)?.body.embeds[0]);
    expect(paid.title).toBe('🪙 +110 FluxCoins');
    // 110 das missões + 25 da vitória.
    expect(paid.description).toContain('Saldo: **135**');
    const again = say(JOAO, '!coletar');
    expect((await waitFor(() => replyTo(again)?.body)).content).toMatch(/Nenhuma missão concluída/);
  });

  it('etapa 7: Night Fluxer com votação por reação, equipes com sala de voz, !night e limpeza das salas', async () => {
    const { closeDueWeeklyEvents, cleanupEndedNights } = await import('../src/schedulers/weeklyEvent.js');
    const { cancelTournament } = await import('../src/services/tournaments.js');
    const owner = user(OWNER_ID, 'dono');

    const open = say(owner, '!admin evento-semanal');
    await waitFor(() => replyTo(open));
    const announce = await waitFor(() =>
      mock.callsTo('POST', new RegExp(`^/channels/${CHANNELS.eventos}/messages$`)).find((c) => /Night Fluxer/.test(c.body.content ?? '')),
    );
    const msgId = announce.response.id;
    expect(announce.body.embeds[0].title).toMatch(/^🌙 Night Fluxer/);
    expect(announce.body.embeds[0].fields[0].name).toBe('🗳️ Votação do jogo');
    // ✅ para inscrição e 1️⃣–4️⃣ para votar.
    await waitFor(() => mock.callsTo('PUT', new RegExp(`/messages/${msgId}/reactions/`)).length === 5);

    const players = ['100', '200', '300', '400'].map((id) => user(id, `p${id}`));
    for (const pl of players) react(pl, msgId, '✅', CHANNELS.eventos);
    react(players[0], msgId, '2️⃣', CHANNELS.eventos);
    react(players[1], msgId, '2⃣', CHANNELS.eventos);
    react(players[2], msgId, '1️⃣', CHANNELS.eventos);
    const tournament = await prisma.tournament.findFirstOrThrow({ where: { messageId: msgId } });
    await until(async () => (await prisma.tournamentEntry.count({ where: { tournamentId: tournament.id } })) === 4);
    await until(async () => (await prisma.eventVote.count()) === 3);
    // As reações também atualizam o anúncio; espera terminarem antes de fechar.
    await until(async () => mock.callsTo('PATCH', new RegExp(`/messages/${msgId}$`)).length >= 7);
    const night = await prisma.weeklyEvent.findUniqueOrThrow({ where: { tournamentId: tournament.id } });
    const options = JSON.parse(night.options) as string[];

    // A inscrição fecha: jogo mais votado, 2 equipes de 2, uma sala de voz para cada.
    await prisma.tournament.update({ where: { id: tournament.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    await closeDueWeeklyEvents(client);
    const rooms = mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/channels$`)).filter((c) => c.body.type === 2);
    expect(rooms.map((r) => r.body.name)).toEqual([`🔊 Night #${night.id} · Lobos`, `🔊 Night #${night.id} · Dragões`]);
    expect(rooms[0].body.user_limit).toBe(2);
    const started = mock
      .callsTo('POST', new RegExp(`^/channels/${CHANNELS.eventos}/messages$`))
      .find((c) => /o jogo escolhido foi/.test(c.body.content ?? ''));
    expect(started!.body.content).toContain(`**${options[1]}**`);

    const st = say(GUSTAVO, '!night');
    const status = await waitFor(() => replyTo(st)?.body);
    expect(status.content).toMatch(/Em andamento/);
    expect(status.embeds[0].fields.find((f: { name: string }) => f.name === '🛡️ Equipes e salas').value).toMatch(/Lobos.*🔊 <#c\d+>/);

    // Fim do evento: as salas de voz são apagadas.
    await cancelTournament(tournament.id);
    await cleanupEndedNights(client);
    for (const r of rooms) {
      const id = (await prisma.eventTeam.findFirstOrThrow({ where: { name: r.body.name.split(' · ')[1] } })).voiceChannelId;
      expect(mock.callsTo('DELETE', new RegExp(`^/channels/${id}$`))).toHaveLength(1);
    }
    expect((await prisma.weeklyEvent.findUniqueOrThrow({ where: { id: night.id } })).status).toBe('CANCELLED');
  });

  it('etapa 7: Night Fluxer com poucos inscritos é cancelado e marcado como CANCELLED', async () => {
    const { openWeeklyEvent, closeDueWeeklyEvents } = await import('../src/schedulers/weeklyEvent.js');
    const t = await openWeeklyEvent(client);
    await prisma.tournament.update({ where: { id: t.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    await closeDueWeeklyEvents(client);
    const sent = mock.callsTo('POST', new RegExp(`^/channels/${CHANNELS.eventos}/messages$`)).at(-1)!;
    expect(sent.body.content).toMatch(/cancelado: São necessários pelo menos 2 inscritos/);
    expect((await prisma.weeklyEvent.findUniqueOrThrow({ where: { tournamentId: t.id } })).status).toBe('CANCELLED');
    expect(mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/channels$`))).toHaveLength(0);
  });

  it('etapa 7: !grupo cria, ajusta, privatiza com senha, expulsa, transfere e some quando vazio', async () => {
    const { cleanupEmptyRooms } = await import('../src/services/notifications/voiceRooms.js');
    const create = say(GUSTAVO, '!grupo');
    const created = await waitFor(() => replyTo(create)?.body);
    const post = mock.callsTo('POST', new RegExp(`^/guilds/${GUILD_ID}/channels$`)).at(-1)!;
    expect(post.body).toMatchObject({ name: 'Grupo do gustavo', type: 2 });
    const room = await prisma.voiceRoom.findFirstOrThrow({ where: { ownerId: '100' } });
    expect(created.embeds[0].description).toContain(`<#${room.channelId}>`);
    const again = say(GUSTAVO, '!grupo');
    expect((await waitFor(() => replyTo(again)?.body)).content).toMatch(/já tem um grupo/);

    const lim = say(GUSTAVO, '!grupo limite 5');
    await waitFor(() => replyTo(lim));
    expect(mock.callsTo('PATCH', new RegExp(`^/channels/${room.channelId}$`)).at(-1)!.body).toEqual({ user_limit: 5 });

    // Privado com senha: nega CONNECT para @everyone e apaga a mensagem com a senha.
    const priv = say(GUSTAVO, '!grupo privado abacaxi');
    await waitFor(() => replyTo(priv));
    const overwrites = mock.callsTo('PATCH', new RegExp(`^/channels/${room.channelId}$`)).at(-1)!.body.permission_overwrites;
    expect(overwrites[0]).toEqual({ id: GUILD_ID, type: 0, deny: String(1n << 20n) });
    expect(overwrites.some((o: { id: string }) => o.id === '100')).toBe(true);
    expect(mock.callsTo('DELETE', new RegExp(`^/channels/${CHANNELS.comandos}/messages/${priv.id}$`))).toHaveLength(1);
    expect((await prisma.voiceRoom.findUniqueOrThrow({ where: { id: room.id } })).passwordHash).not.toContain('abacaxi');

    const wrong = say(LUCAS, '!grupo entrar <@100> errada', [GUSTAVO]);
    expect((await waitFor(() => replyTo(wrong)?.body)).content).toMatch(/Senha incorreta/);
    const right = say(LUCAS, '!grupo entrar <@100> abacaxi', [GUSTAVO]);
    await waitFor(() => replyTo(right));
    expect(mock.callsTo('PUT', new RegExp(`^/channels/${room.channelId}/permissions/200$`)).at(-1)!.body).toEqual({
      type: 1,
      allow: String(1n << 20n),
    });

    // Lucas entra na sala; só quem está na sala pode virar líder.
    const voice = (id: string, u: ReturnType<typeof user>, channel: string | null) =>
      mock.dispatch('VOICE_STATE_UPDATE', { guild_id: GUILD_ID, channel_id: channel, user_id: id, member: { user: u, roles: [] } });
    const cur = say(GUSTAVO, '!grupo lider <@300>', [CURIOSO]);
    expect((await waitFor(() => replyTo(cur)?.body)).content).toMatch(/precisa estar na sala/);
    voice('200', LUCAS, room.channelId);
    voice('300', CURIOSO, room.channelId);
    const kick = say(GUSTAVO, '!grupo expulsar <@300>', [CURIOSO]);
    await waitFor(() => replyTo(kick));
    expect(mock.callsTo('PATCH', new RegExp(`^/guilds/${GUILD_ID}/members/300$`)).at(-1)!.body).toEqual({ channel_id: null });
    expect(mock.callsTo('PUT', new RegExp(`^/channels/${room.channelId}/permissions/300$`)).at(-1)!.body.deny).toBe(String(1n << 20n));

    const lead = say(GUSTAVO, '!grupo lider <@200>', [LUCAS]);
    await waitFor(() => replyTo(lead));
    expect((await prisma.voiceRoom.findUniqueOrThrow({ where: { id: room.id } })).ownerId).toBe('200');

    // Todos saem: depois do prazo, a sala é apagada.
    voice('200', LUCAS, null);
    voice('300', CURIOSO, null);
    await until(async () => {
      const r = await prisma.voiceRoom.findUniqueOrThrow({ where: { id: room.id } });
      return Boolean(r.emptySince && r.emptySince > r.createdAt);
    });
    await cleanupEmptyRooms(client);
    expect(await prisma.voiceRoom.count()).toBe(1);
    await cleanupEmptyRooms(client, new Date(Date.now() + 2 * 60_000));
    expect(await prisma.voiceRoom.count()).toBe(0);
    expect(mock.callsTo('DELETE', new RegExp(`^/channels/${room.channelId}$`))).toHaveLength(1);
  });

  it('música: !tocar entra na sala (op 4 → credencial LiveKit), fila, pausa, volume, pular, player fixado, histórico e !parar', async () => {
    const { MusicService, setMusicService } = await import('../src/services/music/musicService.js');
    const { YouTubeResolver } = await import('../src/services/music/youtube.js');
    const { SpotifyResolver } = await import('../src/services/music/spotify.js');
    const { FakeSink, sineOpener } = await import('./musicHelpers.js');
    const { guildSettings } = await import('../src/database/guildSettingsRepository.js');
    const { readFileSync } = await import('node:fs');
    const fx = (n: string) => readFileSync(new URL(`./fixtures/music/${n}`, import.meta.url), 'utf8');

    const sinks: { endpoint: string; token: string; sink: InstanceType<typeof FakeSink>; drop: () => void }[] = [];
    const service = new MusicService(client, {
      youtube: new YouTubeResolver('yt-dlp', async (_c, args) =>
        args.includes('--flat-playlist') ? fx('playlist.json') : fx('video.json'),
      ),
      spotify: new SpotifyResolver('', ''),
      opener: sineOpener(30),
      sinkFactory: async (endpoint, token, drop) => {
        const sink = new FakeSink(1);
        sinks.push({ endpoint, token, sink, drop });
        return sink;
      },
      grantTimeoutMs: 300,
    });
    setMusicService(service);
    await guildSettings.setChannel(GUILD_ID, 'music', 'c-musica');
    const voice = (id: string, u: ReturnType<typeof user>, channel: string | null) =>
      mock.dispatch('VOICE_STATE_UPDATE', { guild_id: GUILD_ID, channel_id: channel, user_id: id, member: { user: u, roles: [] } });

    // Fora da voz: precisa entrar numa sala.
    const noVoice = say(GUSTAVO, '!tocar never gonna give you up');
    expect((await waitFor(() => replyTo(noVoice)?.body)).content).toMatch(/Entre numa sala de voz/);

    voice('100', GUSTAVO, 'voz-musica');
    const play = say(GUSTAVO, '!tocar never gonna give you up');
    const playReply = await waitFor(() => replyTo(play)?.body, 5000);
    expect(playReply.embeds[0].title).toBe('🎵 Never Gonna Give You Up');
    expect(playReply.embeds[0].description).toContain('Tocando em <#voz-musica>');
    // Entrou pelo Gateway (op 4, surdo) e conectou no LiveKit com a credencial do Fluxer.
    const op4 = mock.gatewayFrames.filter((f) => f.op === 4);
    expect(op4[0].d).toEqual({ guild_id: GUILD_ID, channel_id: 'voz-musica', self_mute: false, self_deaf: true });
    expect(sinks).toHaveLength(1);
    expect(sinks[0]).toMatchObject({ endpoint: 'wss://livekit.fluxer.test', token: 'token-livekit' });
    await until(async () => sinks[0].sink.frames.length > 20);

    const pl = say(GUSTAVO, '!tocar https://www.youtube.com/playlist?list=PL123');
    const plReply = await waitFor(() => replyTo(pl)?.body, 5000);
    expect(plReply.embeds[0].title).toBe('📜 Lo-fi do Reino');
    expect(plReply.embeds[0].description).toMatch(/\*\*2\*\* músicas adicionadas.*Adicionada à fila/s);
    const q = say(GUSTAVO, '!fila');
    expect((await waitFor(() => replyTo(q)?.body)).embeds[0].description).toMatch(/Faixa 1[\s\S]*Faixa 2/);

    // Quem não está na sala não controla.
    const outsider = say(LUCAS, '!pular');
    expect((await waitFor(() => replyTo(outsider)?.body)).content).toMatch(/Entre em <#voz-musica>/);

    const pause = say(GUSTAVO, '!pausar');
    await waitFor(() => replyTo(pause));
    const frozen = sinks[0].sink.frames.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(sinks[0].sink.frames.length).toBeLessThanOrEqual(frozen + 1);
    const resume = say(GUSTAVO, '!continuar');
    await waitFor(() => replyTo(resume));
    const vol = say(GUSTAVO, '!volume 50');
    expect((await waitFor(() => replyTo(vol)?.body)).content).toBe('🔊 Volume: **50%**');
    const skip = say(GUSTAVO, '!pular');
    expect((await waitFor(() => replyTo(skip)?.body)).content).toContain('Never Gonna Give You Up');
    await until(async () => service.player.queue.current?.title === 'Faixa 1');

    // Player fixado em #musica, histórico e fila salvos no banco.
    const pinned = await waitFor(() => mock.callsTo('POST', /^\/channels\/c-musica\/messages$/)[0], 5000);
    expect(pinned.body.embeds[0].title).toMatch(/Tocando/);
    await until(async () => (await prisma.musicHistory.count()) >= 2);
    await until(async () => (await prisma.musicQueue.count()) >= 1);
    const hist = await prisma.musicHistory.findMany({ orderBy: { id: 'asc' } });
    expect(hist.map((h) => [h.title, h.channelId, h.requestedById])).toEqual([
      ['Never Gonna Give You Up', 'voz-musica', '100'],
      ['Faixa 1', 'voz-musica', '100'],
    ]);

    // !parar: sai da sala LiveKit e do canal (op 4 com channel_id null e o connection_id).
    const stop = say(GUSTAVO, '!parar');
    await waitFor(() => replyTo(stop), 5000);
    expect(sinks[0].sink.closed).toBe(true);
    expect(mock.gatewayFrames.filter((f) => f.op === 4).at(-1).d).toEqual({
      guild_id: GUILD_ID,
      channel_id: null,
      connection_id: 'conn-1',
    });
    expect(service.voice.channelId).toBeNull();

    // Fluxer recusa a entrada (sem credencial): erro claro, sem ficar preso.
    mock.voiceGrant = null;
    const refused = say(GUSTAVO, '!tocar never gonna');
    expect((await waitFor(() => replyTo(refused)?.body, 5000)).content).toMatch(/não liberou a entrada/);
    mock.voiceGrant = () => ({ token: 'token-livekit', endpoint: 'wss://livekit.fluxer.test' });

    // Sala vazia por 5 minutos: o bot sai sozinho.
    const again = say(GUSTAVO, '!tocar never gonna');
    await waitFor(() => replyTo(again)?.body, 5000);
    voice('100', GUSTAVO, null);
    const { voicePresence } = await import('../src/services/voicePresence.js');
    await until(async () => voicePresence.members('voz-musica').length === 0);
    await service.tick(Date.now());
    expect(service.voice.channelId).toBe('voz-musica');
    await service.tick(Date.now() + 6 * 60_000);
    expect(service.voice.channelId).toBeNull();
    await waitFor(() => mock.calls.find((c) => /Saí de <#voz-musica>: ninguém ouvindo/.test(c.body?.content ?? '')));

    // Moderador tira o bot da sala: a música para.
    voice('100', GUSTAVO, 'voz-musica');
    const third = say(GUSTAVO, '!tocar never gonna');
    await waitFor(() => replyTo(third)?.body, 5000);
    mock.dispatch('VOICE_STATE_UPDATE', {
      guild_id: GUILD_ID,
      channel_id: null,
      user_id: BOT_ID,
      member: { user: { id: BOT_ID, username: 'fluxerbot', bot: true }, roles: [] },
    });
    await until(async () => service.voice.channelId === null && service.player.state === 'idle');

    // A sala LiveKit cai sozinha com músicas na fila: um aviso só, fila guardada para o !continuar.
    const fourth = say(GUSTAVO, '!tocar https://www.youtube.com/playlist?list=PL123');
    await waitFor(() => replyTo(fourth)?.body, 5000);
    await until(async () => service.player.state === 'playing');
    const before = mock.calls.length;
    sinks.at(-1)!.drop();
    await until(async () => service.voice.channelId === null && service.player.state === 'idle');
    await until(async () => mock.calls.slice(before).some((c) => /conexão de voz caiu/.test(c.body?.content ?? '')));
    await new Promise((r) => setTimeout(r, 100));
    const warnings = mock.calls.slice(before).filter((c) => /conexão de voz caiu|Não consegui tocar/.test(c.body?.content ?? ''));
    expect(warnings.map((w) => w.body.content)).toEqual([
      '⚠️ A conexão de voz caiu. 2 música(s) guardadas: entre numa sala e use `!continuar`.',
    ]);
    expect(service.player.queue.snapshot().map((x) => x.title)).toEqual(['Faixa 1', 'Faixa 2']);
    voice('100', GUSTAVO, null);
    setMusicService(null);
  }, 30_000);
});
