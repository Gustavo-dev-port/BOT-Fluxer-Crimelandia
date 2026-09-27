import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/client.js';
import { progressBar } from '../src/embeds/format.js';
import { hallEmbed } from '../src/embeds/hallEmbed.js';
import { getHallOfFame, leader } from '../src/services/hallOfFame.js';
import { acceptDuel, confirmResult, createDuel, reportResult } from '../src/services/matches.js';
import { getCommunityRivalries, getProfile, getRivalries } from '../src/services/profile.js';
import { endActiveSeason } from '../src/services/seasons.js';
import { honorStatus, playerClass, type HonorContext } from '../src/services/rules/honors.js';
import { computeCommunityRivalries, computeRivalries, HISTORY_SIZE } from '../src/services/rules/rivalry.js';
import { tierProgress } from '../src/services/rules/tiers.js';
import { addCoins } from '../src/services/economy.js';
import { p, resetDb } from './helpers.js';
import { generateDailyMissions, type MissionKind, MISSION_TYPES, MISSIONS_PER_DAY } from '../src/services/rules/missions.js';
import { dateKeyIn } from '../src/utils/calendar.js';
import { VoicePresence } from '../src/services/voicePresence.js';
import { claimRewards, ensureDailyMissions, getPlayerMissions, recordProgress, todayKey } from '../src/services/missions.js';

const day = (n: number) => new Date(2026, 0, n);

describe('barra de progresso e liga', () => {
  it('progressBar', () => {
    expect(progressBar(0, 10)).toBe('▱'.repeat(10));
    expect(progressBar(5, 10)).toBe('▰'.repeat(5) + '▱'.repeat(5));
    expect(progressBar(99, 10, 4)).toBe('▰▰▰▰');
    expect(progressBar(1, 0, 3)).toBe('▰▰▰');
  });
  it('tierProgress dentro das divisões', () => {
    expect(tierProgress(1000)).toEqual({ next: 'Bronze II', percent: 0, remaining: 67 });
    expect(tierProgress(1150)).toMatchObject({ next: 'Prata III', remaining: 50 });
    expect(tierProgress(1599)).toMatchObject({ next: 'Platina III', remaining: 1 });
    expect(tierProgress(900)).toEqual({ next: 'Bronze III', percent: 50, remaining: 100 });
    expect(tierProgress(1950)).toMatchObject({ next: 'Mestre', remaining: 50 });
    expect(tierProgress(2100)).toEqual({ next: null, percent: 100, remaining: 0 });
  });
});

describe('títulos e classe', () => {
  const base: HonorContext = {
    careerMatches: 0,
    careerWins: 0,
    duelWins: 0,
    bestStreakEver: 0,
    seasonTitles: 0,
    tournamentTitles: 0,
    rating: 1000,
  };
  it('nenhum título no começo, com progresso zerado', () => {
    const s = honorStatus(base);
    expect(s.map((x) => x.title.emoji)).toEqual(['👑', '⚔️', '🧙', '🐺', '🔥']);
    expect(s.every((x) => !x.earned && x.current === 0)).toBe(true);
  });
  it('conquista cada título pela regra', () => {
    const s = honorStatus({ ...base, seasonTitles: 1, careerMatches: 50, rating: 1600, duelWins: 25, bestStreakEver: 12 });
    expect(s.every((x) => x.earned)).toBe(true);
    // O progresso não passa do alvo.
    expect(s.find((x) => x.title.key === 'unstoppable')).toMatchObject({ current: 10, target: 10 });
  });
  it('classes', () => {
    expect(playerClass({ careerMatches: 3, careerWins: 3 }).name).toBe('Recruta');
    expect(playerClass({ careerMatches: 10, careerWins: 7 }).name).toBe('Estrategista');
    expect(playerClass({ careerMatches: 40, careerWins: 15 }).name).toBe('Berserker');
    expect(playerClass({ careerMatches: 10, careerWins: 5 }).name).toBe('Cavaleiro');
  });
});

describe('rivalidades', () => {
  it('histórico: mais recentes primeiro, limitado', () => {
    const records = Array.from({ length: 7 }, (_, i) => ({ opponentId: 'lucas', won: i % 2 === 0, playedAt: day(i + 1) }));
    const [r] = computeRivalries(records);
    expect(r.history).toHaveLength(HISTORY_SIZE);
    expect(r.history[0].playedAt.getDate()).toBe(7);
    expect(r.history[0].won).toBe(true);
  });
  it('da comunidade: pares únicos, mínimo de 2 duelos, mais disputadas primeiro', () => {
    const d = (winnerId: string, loserId: string, n: number) => ({ winnerId, loserId, playedAt: day(n) });
    const top = computeCommunityRivalries([
      d('b', 'a', 1),
      d('a', 'b', 2),
      d('a', 'b', 3),
      d('c', 'd', 4),
      d('d', 'c', 5),
      d('c', 'd', 6),
      d('e', 'f', 7), // só 1 duelo: fica de fora
    ]);
    expect(top).toHaveLength(2);
    // Empate em 3 duelos e 2×1: desempata pelo mais recente.
    expect(top[0]).toMatchObject({ playerA: 'c', playerB: 'd', total: 3, winsA: 2, winsB: 1 });
    expect(top[1]).toMatchObject({ playerA: 'a', playerB: 'b', total: 3, winsA: 2, winsB: 1 });
  });
  it('leader ignora zeros e mantém o primeiro no empate', () => {
    expect(leader(new Map([['a', 0]]))).toBeNull();
    expect(
      leader(
        new Map([
          ['a', 2],
          ['b', 2],
          ['c', 1],
        ]),
      ),
    ).toEqual({ playerId: 'a', value: 2 });
  });
});

describe('Hall do Reino e perfil (banco)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  async function playDuel(winner: string, loser: string) {
    const m = await createDuel(p(winner), p(loser), 'CS2');
    await acceptDuel(loser, m.id);
    await reportResult(winner, winner, m.id);
    return confirmResult(loser, m.id);
  }

  it('sem partidas: tudo vazio', async () => {
    const hall = await getHallOfFame();
    expect(hall).toMatchObject({ champion: null, mvpWeek: null, mostActive: null, bestStreak: null, mostWins: null, richest: null });
    expect(hallEmbed(hall).fields!.every((f) => f.value.includes('aguarda'))).toBe(true);
  });

  it('calcula cada honraria', async () => {
    await playDuel('gustavo', 'lucas');
    await playDuel('gustavo', 'lucas');
    await playDuel('gustavo', 'joao');
    await playDuel('lucas', 'joao');
    await addCoins(prisma, 'joao', 500, 'teste');

    let hall = await getHallOfFame();
    // Sem temporada encerrada, o "campeão" é o líder atual.
    expect(hall.champion).toMatchObject({ playerId: 'gustavo', current: true, seasonNumber: 1 });
    expect(hall.mvpWeek).toEqual({ playerId: 'gustavo', value: 3 });
    expect(hall.mostActive?.value).toBe(3);
    expect(hall.bestStreak).toEqual({ playerId: 'gustavo', value: 3 });
    expect(hall.mostWins).toEqual({ playerId: 'gustavo', value: 3 });
    expect(hall.richest?.playerId).toBe('joao');

    await endActiveSeason();
    hall = await getHallOfFame();
    expect(hall.champion).toMatchObject({ playerId: 'gustavo', current: false, seasonNumber: 1 });
    // A carreira soma as temporadas.
    await playDuel('lucas', 'gustavo');
    hall = await getHallOfFame();
    expect(hall.mostWins).toEqual({ playerId: 'gustavo', value: 3 });
    expect((await getHallOfFame(prisma, new Date(Date.now() + 8 * 86_400_000))).mvpWeek).toBeNull();
  });

  it('perfil traz o contexto dos títulos; rivalidades da comunidade', async () => {
    await playDuel('gustavo', 'lucas');
    await playDuel('lucas', 'gustavo');
    await playDuel('gustavo', 'lucas');
    await playDuel('gustavo', 'joao');

    const profile = await getProfile('gustavo');
    expect(profile!.honors).toMatchObject({ careerMatches: 4, careerWins: 3, duelWins: 3, bestStreakEver: 2 });

    const [r] = await getRivalries('gustavo');
    expect(r.history.map((h) => h.won)).toEqual([true, false, true]);

    const community = await getCommunityRivalries();
    expect(community).toHaveLength(1);
    expect(community[0]).toMatchObject({ playerA: 'gustavo', playerB: 'lucas', total: 3, winsA: 2, winsB: 1 });
  });
});

// ─── Etapa 6: missões diárias ───────────────────────────────────────────────

describe('missões: regras', () => {
  it('sorteio determinístico: 3 tipos diferentes, recompensas de 20 a 100', () => {
    const a = generateDailyMissions('2026-09-28');
    expect(a).toEqual(generateDailyMissions('2026-09-28'));
    expect(a).toHaveLength(MISSIONS_PER_DAY);
    expect(new Set(a.map((m) => m.kind)).size).toBe(3);
    // Dias diferentes variam.
    const days = Array.from({ length: 14 }, (_, i) => generateDailyMissions(`2026-10-${String(i + 1).padStart(2, '0')}`));
    expect(new Set(days.map((d) => d.map((m) => m.kind).join())).size).toBeGreaterThan(3);
    for (const t of MISSION_TYPES) for (const tier of t.tiers) expect(tier.reward).toBeGreaterThanOrEqual(20);
    for (const t of MISSION_TYPES) for (const tier of t.tiers) expect(tier.reward).toBeLessThanOrEqual(100);
  });
  it('dia no fuso do servidor', () => {
    expect(dateKeyIn(new Date('2026-09-28T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09-27');
    expect(dateKeyIn(new Date('2026-09-28T03:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09-28');
  });
});

describe('presença em voz', () => {
  const st = (id: string, channel: string | null, bot = false) => ({
    user_id: id,
    channel_id: channel,
    member: { user: { id, username: `u${id}`, bot } },
  });
  it('entradas, trocas de sala, minutos e contagem por sala; ignora bots e mudanças de mute', () => {
    const v = new VoicePresence();
    const joins: string[] = [];
    const minutes: [string, number][] = [];
    v.listen({ onJoin: (u, c) => joins.push(`${u.id}@${c}`), onMinutes: (u, m) => minutes.push([u.id, m]) });
    const t0 = 1_000_000;
    v.update(st('1', 'sala-a'), t0);
    v.update(st('9', 'sala-a', true), t0);
    v.update(st('1', 'sala-a'), t0 + 5_000); // só mute
    expect(v.count('sala-a')).toBe(1);
    v.flush(t0 + 90_000); // 1 min e meio: conta 1, guarda 30s
    v.update(st('1', 'sala-b'), t0 + 150_000); // mais 1 min ao trocar
    v.update(st('1', null), t0 + 200_000); // 50s: não completa minuto
    expect(joins).toEqual(['1@sala-a', '1@sala-b']);
    expect(minutes).toEqual([
      ['1', 1],
      ['1', 1],
    ]);
    expect(v.channelOf('1')).toBeNull();
  });
  it('reset (GUILD_CREATE): quem já estava não conta como entrada; quem sumiu sai', () => {
    const v = new VoicePresence();
    const joins: string[] = [];
    const leaves: string[] = [];
    v.listen({ onJoin: (u) => joins.push(u.id), onLeave: (u) => leaves.push(u.id) });
    v.update(st('1', 'a'), 0);
    v.reset([st('2', 'a'), st('3', 'b')], 1000);
    expect(joins).toEqual(['1']);
    expect(leaves).toEqual(['1']);
    expect(v.members('a')).toEqual(['2']);
    expect(v.count('b')).toBe(1);
  });
});

describe('missões: banco', () => {
  beforeEach(resetDb);
  const now = new Date();
  async function setMissions(...kinds: [MissionKind, number, number][]) {
    const date = todayKey(now);
    for (const [kind, target, reward] of kinds) await prisma.dailyMission.create({ data: { date, kind, target, reward } });
  }

  it('gera 3 missões por dia uma vez só', async () => {
    const a = await ensureDailyMissions(now);
    const b = await ensureDailyMissions(now);
    expect(a).toHaveLength(3);
    expect(b.map((m) => m.id)).toEqual(a.map((m) => m.id));
  });

  it('progresso limitado ao alvo, conclui uma vez, coleta paga uma vez', async () => {
    await setMissions(['send_messages', 3, 20], ['win_duels', 1, 30], ['join_voice', 2, 30]);
    const ref = p('gustavo');
    expect(await recordProgress(ref, 'send_messages', 2, now)).toEqual([]);
    const done = await recordProgress(ref, 'send_messages', 5, now);
    expect(done.map((d) => d.mission.kind)).toEqual(['send_messages']);
    expect(await recordProgress(ref, 'send_messages', 1, now)).toEqual([]);
    // Tipo que não está no dia não faz nada.
    expect(await recordProgress(ref, 'react_messages', 1, now)).toEqual([]);

    const view = await getPlayerMissions('gustavo', now);
    expect(view.find((v) => v.mission.kind === 'send_messages')).toMatchObject({ progress: 3, completed: true, claimed: false });
    expect(view.find((v) => v.mission.kind === 'win_duels')).toMatchObject({ progress: 0, completed: false });

    const first = await claimRewards('gustavo', now);
    expect(first).toMatchObject({ total: 20, balance: 20 });
    expect((await claimRewards('gustavo', now)).total).toBe(0);
    const tx = await prisma.transaction.findMany({ where: { playerId: 'gustavo' } });
    expect(tx.map((t) => [t.amount, t.reason])).toEqual([[20, 'Missão diária: 💬 Envie 3 mensagens no servidor']]);
  });

  it('eventos simultâneos do mesmo jogador somam certo', async () => {
    await setMissions(['send_messages', 50, 50]);
    await Promise.all(Array.from({ length: 10 }, () => recordProgress(p('lucas'), 'send_messages', 1, now)));
    expect((await getPlayerMissions('lucas', now))[0].progress).toBe(10);
  });
});

describe('missões: casos de borda', () => {
  beforeEach(resetDb);
  it('jogador só por ID que ainda não existe é ignorado (sem erro de chave estrangeira)', async () => {
    await prisma.dailyMission.create({ data: { date: todayKey(), kind: 'react_messages', target: 1, reward: 20 } });
    await expect(recordProgress('fantasma', 'react_messages')).resolves.toEqual([]);
  });
});
