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
