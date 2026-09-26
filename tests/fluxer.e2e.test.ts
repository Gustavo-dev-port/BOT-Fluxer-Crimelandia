/**
 * Teste ponta a ponta: o bot real (FluxerClient + handlers) contra um
 * servidor Fluxer falso que segue docs.fluxer.app.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { onMessageCreate, onReaction } from '../src/bot/events.js';
import { prisma } from '../src/db.js';
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

const user = (id: string, name: string) => ({ id, username: name, global_name: null, discriminator: '0000', avatar: null });
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
  });
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
    const emojis = mock.callsTo('PUT', new RegExp(`/messages/${challenge.id}/reactions/`)).map((c) => decodeURIComponent(c.path.split('/')[6]));
    expect(emojis).toEqual(['✅', '❌']);

    // Quem não participa não consegue aceitar.
    react(CURIOSO, challenge.id, '✅');
    // Lucas aceita reagindo: o bot edita a mensagem do desafio.
    react(LUCAS, challenge.id, '✅');
    const accepted = await waitFor(() => mock.callsTo('PATCH', new RegExp(`/messages/${challenge.id}$`))[0]);
    expect(accepted.body.embeds[0].title).toMatch(/aceita/);

    const report = say(GUSTAVO, '!resultado <@100>', [GUSTAVO]);
    const awaiting = await waitFor(() => replyTo(report)?.response);
    expect(awaiting.embeds[0].title).toMatch(/Resultado informado/);
    expect(awaiting.content).toBe('<@200>');

    // Gustavo não pode confirmar o próprio resultado: recebe aviso no canal.
    react(GUSTAVO, awaiting.id, '✅');
    await waitFor(() => mock.calls.find((c) => c.method === 'POST' && /<@100> ❌/.test(c.body?.content ?? '')));

    // Lucas confirma com ✅ (o Fluxer pode mandar ⚠️/✅ com ou sem U+FE0F).
    react(LUCAS, awaiting.id, '✅️');
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
    react(LUCAS, challenge.id, '❌');
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
    expect(reply.body.embeds[0].fields.map((f: any) => f.name)).toEqual(['Duelos', 'Ranking', 'Times e campeonatos', 'Economia', 'Administração']);
    const one = say(GUSTAVO, '!ajuda rival');
    expect((await waitFor(() => replyTo(one))).body.embeds[0].title).toContain('!rival');
  });

  it('ignora mensagens de bots, de outros servidores e sem prefixo', async () => {
    mock.dispatch('MESSAGE_CREATE', { ...say(GUSTAVO, 'oi pessoal'), id: 'x1' });
    mock.dispatch('MESSAGE_CREATE', {
      id: 'x2', channel_id: 'c', guild_id: 'outro', channel_type: 0, author: GUSTAVO, type: 0, content: '!ajuda',
      timestamp: '', mentions: [], mention_roles: [], embeds: [],
    });
    mock.dispatch('MESSAGE_CREATE', {
      id: 'x3', channel_id: 'c', guild_id: GUILD_ID, channel_type: 0, author: { ...LUCAS, bot: true }, type: 0, content: '!ajuda',
      timestamp: '', mentions: [], mention_roles: [], embeds: [],
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
});
