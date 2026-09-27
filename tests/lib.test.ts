import { describe, expect, it } from 'vitest';
import { eloDelta, expectedScore, softReset, teamEloDelta } from '../src/services/rules/elo.js';
import { tierFor } from '../src/services/rules/tiers.js';
import {
  advanceTarget,
  roundCount,
  roundRobin,
  roundRobinStandings,
  seedOrder,
  singleEliminationBracket,
  singleEliminationFirstRound,
} from '../src/services/rules/bracket.js';
import { computeRivalries, relativeDay } from '../src/services/rules/rivalry.js';
import { newlyUnlocked } from '../src/services/rules/achievements.js';
import { parseHexColor } from '../src/services/rules/shop.js';

describe('elo', () => {
  it('ratings iguais → 50%', () => expect(expectedScore(1000, 1000)).toBe(0.5));
  it('vitória entre iguais vale K/2', () => expect(eloDelta(1000, 1000, 32)).toBe(16));
  it('zebra vale mais que favorito', () => expect(eloDelta(1000, 1400, 32)).toBeGreaterThan(eloDelta(1400, 1000, 32)));
  it('nunca menos que 1', () => expect(eloDelta(3000, 100, 32)).toBe(1));
  it('times usam a média', () => expect(teamEloDelta([900, 1100], [1000, 1000], 32)).toBe(16));
  it('soft reset', () => {
    expect(softReset(1400, 1000, 0)).toBe(1000);
    expect(softReset(1400, 1000, 0.5)).toBe(1200);
    expect(softReset(800, 1000, 0.5)).toBe(900);
  });
});

describe('tiers', () => {
  it('rating inicial é Bronze III', () => expect(tierFor(1000).label).toBe('Bronze III'));
  it('1480 é Ouro II (exemplo do perfil)', () => expect(tierFor(1480).label).toBe('Ouro II'));
  it('abaixo de 1000 é Ferro', () => expect(tierFor(950).label).toBe('Ferro'));
  it('2000+ é Mestre', () => expect(tierFor(2300).label).toBe('Mestre'));
  it('topo da liga é divisão I', () => expect(tierFor(1599).label).toBe('Ouro I'));
});

describe('bracket', () => {
  it('ordem de seeds', () => expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]));
  it('rodadas', () => {
    expect(roundCount(2)).toBe(1);
    expect(roundCount(5)).toBe(3);
    expect(roundCount(8)).toBe(3);
  });
  it('byes vão para os melhores seeds e nunca bye x bye', () => {
    for (let n = 2; n <= 33; n++) {
      const entries = Array.from({ length: n }, (_, i) => i + 1);
      const first = singleEliminationFirstRound(entries);
      for (const m of first) expect(m.entry1 !== null || m.entry2 !== null).toBe(true);
      const byes = first.filter((m) => m.entry1 === null || m.entry2 === null).map((m) => m.entry1 ?? m.entry2);
      expect(byes.sort((a, b) => a! - b!)).toEqual(entries.slice(0, byes.length));
      expect(new Set(first.flatMap((m) => [m.entry1, m.entry2]).filter((x) => x !== null)).size).toBe(n);
    }
  });
  it('chave completa tem n-1 partidas reais + byes', () => {
    const b = singleEliminationBracket([1, 2, 3, 4, 5, 6]);
    expect(b.filter((m) => m.round === 1)).toHaveLength(4);
    expect(b.filter((m) => m.round === 2)).toHaveLength(2);
    expect(b.filter((m) => m.round === 3)).toHaveLength(1);
  });
  it('avanço', () => {
    expect(advanceTarget(1, 0)).toEqual({ round: 2, slot: 0, position: 1 });
    expect(advanceTarget(1, 3)).toEqual({ round: 2, slot: 1, position: 2 });
  });
  it('todos contra todos: cada par exatamente uma vez', () => {
    for (const n of [2, 3, 4, 5, 8]) {
      const entries = Array.from({ length: n }, (_, i) => i + 1);
      const matches = roundRobin(entries);
      expect(matches).toHaveLength((n * (n - 1)) / 2);
      const pairs = new Set(matches.map((m) => [m.entry1, m.entry2].sort().join('-')));
      expect(pairs.size).toBe(matches.length);
      // Ninguém joga duas vezes na mesma rodada.
      for (const r of new Set(matches.map((m) => m.round))) {
        const inRound = matches.filter((m) => m.round === r).flatMap((m) => [m.entry1, m.entry2]);
        expect(new Set(inRound).size).toBe(inRound.length);
      }
    }
  });
  it('classificação com desempate por confronto direto', () => {
    const table = roundRobinStandings(
      [1, 2, 3],
      [
        { winner: 2, loser: 1 },
        { winner: 1, loser: 3 },
        { winner: 3, loser: 2 },
        { winner: 2, loser: 3 },
      ],
    );
    expect(table[0].entry).toBe(2);
  });
});

describe('rivalidades', () => {
  it('ordena pelo adversário mais enfrentado', () => {
    const d = (opponentId: string, won: boolean, day: number) => ({ opponentId, won, playedAt: new Date(2026, 0, day) });
    const r = computeRivalries([d('lucas', true, 1), d('lucas', false, 5), d('lucas', true, 3), d('joao', true, 2)]);
    expect(r[0]).toMatchObject({ opponentId: 'lucas', total: 3, wins: 2, losses: 1 });
    expect(r[0].lastPlayedAt.getDate()).toBe(5);
  });
  it('dias relativos', () => {
    const now = new Date(2026, 5, 10, 12);
    expect(relativeDay(new Date(2026, 5, 10, 1), now)).toBe('hoje');
    expect(relativeDay(new Date(2026, 5, 9, 23), now)).toBe('ontem');
    expect(relativeDay(new Date(2026, 5, 5), now)).toBe('há 5 dias');
  });
});

describe('conquistas e loja', () => {
  it('desbloqueia só o que falta', () => {
    const got = newlyUnlocked(
      { totalWins: 10, totalMatches: 12, currentStreak: 5, tournamentTitles: 0, seasonTitles: 0 },
      new Set(['first_win']),
    ).map((a) => a.key);
    expect(got).toEqual(['wins_10', 'streak_5']);
  });
  it('cores', () => {
    expect(parseHexColor('#ff8800')).toBe(0xff8800);
    expect(parseHexColor('f80')).toBe(0xff8800);
    expect(parseHexColor('xyz')).toBeNull();
  });
});

describe('etapa 4: duração, apelidos e calendário', async () => {
  const { parseDuration } = await import('../src/utils/args.js');
  const { specialNickname } = await import('../src/services/rules/shop.js');
  const { startOfNextMonth } = await import('../src/utils/calendar.js');
  const { formatDuration } = await import('../src/embeds/format.js');

  it('duração da partida', () => {
    expect(parseDuration('25min')).toBe(1500);
    expect(parseDuration('25m')).toBe(1500);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('1h20')).toBe(4800);
    expect(parseDuration('1h20m')).toBe(4800);
    expect(parseDuration('<@1>')).toBeNull();
    expect(parseDuration('25')).toBeNull();
    expect(formatDuration(1500)).toBe('25 min');
    expect(formatDuration(4800)).toBe('1h20');
    expect(formatDuration(3600)).toBe('1h');
  });

  it('apelido especial: prefixo, sem menções e no máximo 32 caracteres', () => {
    expect(specialNickname('Rei do Clutch')).toBe('✨ Rei do Clutch');
    expect(specialNickname('  @everyone <@123>  ')).toBe('✨ everyone 123');
    expect(specialNickname('   ')).toBeNull();
    expect(specialNickname('x'.repeat(50))!.length).toBe(32);
  });

  it('temporada mensal termina à meia-noite do dia 1º no fuso configurado', () => {
    const sp = 'America/Sao_Paulo';
    expect(startOfNextMonth(new Date('2026-09-27T01:00:00Z'), sp).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    // 30/09 23:59 em São Paulo ainda é setembro.
    expect(startOfNextMonth(new Date('2026-10-01T02:59:00Z'), sp).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(startOfNextMonth(new Date('2026-12-15T12:00:00Z'), sp).toISOString()).toBe('2027-01-01T03:00:00.000Z');
    // Horário de verão europeu começa no fim de março.
    expect(startOfNextMonth(new Date('2026-03-10T12:00:00Z'), 'Europe/Lisbon').toISOString()).toBe('2026-03-31T23:00:00.000Z');
  });
});
