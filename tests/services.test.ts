import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { MatchStatus, TournamentFormat, TournamentStatus, UserError } from '../src/lib/types.js';
import {
  acceptDuel,
  adminSetResult,
  confirmResult,
  createDuel,
  createTeamChallenge,
  disputeResult,
  expireStaleChallenges,
  reportResult,
} from '../src/services/matches.js';
import { getRanking } from '../src/services/ranking.js';
import { endActiveSeason, getActiveSeason } from '../src/services/seasons.js';
import { createTeam } from '../src/services/teams.js';
import { createTournament, register, startTournament } from '../src/services/tournaments.js';
import { getProfile, getRivalries } from '../src/services/profile.js';
import { purchase } from '../src/services/shop.js';
import { addCoins } from '../src/services/economy.js';
import { p, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function playDuel(winner: string, loser: string, game = 'Valorant') {
  const m = await createDuel(p(winner), p(loser), game);
  await acceptDuel(loser, m.id);
  await reportResult(winner, winner, m.id);
  return confirmResult(loser, m.id);
}

describe('duelo', () => {
  it('fluxo completo: desafio → aceite → resultado → confirmação', async () => {
    const m = await createDuel(p('gustavo'), p('lucas'), 'CS2');
    expect(m.status).toBe(MatchStatus.PENDING);

    // Quem desafiou não pode aceitar o próprio desafio.
    await expect(acceptDuel('gustavo', m.id)).rejects.toThrow(UserError);
    await acceptDuel('lucas');

    const report = await reportResult('gustavo', 'gustavo');
    expect(report.kind).toBe('awaiting');

    // Quem reportou não pode confirmar o próprio resultado.
    await expect(confirmResult('gustavo', m.id)).rejects.toThrow(UserError);

    const result = await confirmResult('lucas');
    expect(result.delta).toBe(16);

    const season = await getActiveSeason();
    const ranking = await getRanking(prisma, season.id);
    expect(ranking.map((r) => [r.playerId, r.rating, r.wins, r.losses])).toEqual([
      ['gustavo', 1016, 1, 0],
      ['lucas', 984, 0, 1],
    ]);

    const [g, l] = await Promise.all([
      prisma.player.findUnique({ where: { id: 'gustavo' } }),
      prisma.player.findUnique({ where: { id: 'lucas' } }),
    ]);
    expect(g!.coins).toBe(25);
    expect(l!.coins).toBe(10);
    expect(result.unlocked.find((u) => u.playerId === 'gustavo')?.achievements.map((a) => a.key)).toContain('first_win');
  });

  it('não permite dois desafios abertos entre os mesmos jogadores', async () => {
    await createDuel(p('a'), p('b'), 'CS2');
    await expect(createDuel(p('b'), p('a'), 'CS2')).rejects.toThrow(/Já existe/);
  });

  it('não permite desafiar a si mesmo', async () => {
    await expect(createDuel(p('a'), p('a'), 'CS2')).rejects.toThrow(UserError);
  });

  it('ambos reportando o mesmo vencedor confirma; vencedores diferentes abrem disputa', async () => {
    const m1 = await createDuel(p('a'), p('b'), 'CS2');
    await acceptDuel('b', m1.id);
    await reportResult('a', 'b', m1.id);
    const agreed = await reportResult('b', 'b', m1.id);
    expect(agreed.kind).toBe('confirmed');

    const m2 = await createDuel(p('a'), p('b'), 'CS2');
    await acceptDuel('b', m2.id);
    await reportResult('a', 'a', m2.id);
    const disagreed = await reportResult('b', 'b', m2.id);
    expect(disagreed.kind).toBe('disputed');

    const resolved = await adminSetResult(m2.id, 'a');
    expect(resolved.match.status).toBe(MatchStatus.CONFIRMED);
  });

  it('contestar deixa a partida em disputa sem alterar o ranking', async () => {
    const m = await createDuel(p('a'), p('b'), 'CS2');
    await acceptDuel('b', m.id);
    await reportResult('a', 'a', m.id);
    const d = await disputeResult('b', m.id);
    expect(d.status).toBe(MatchStatus.DISPUTED);
    const season = await getActiveSeason();
    expect(await getRanking(prisma, season.id)).toHaveLength(0);
  });

  it('expira desafios pendentes antigos', async () => {
    const m = await createDuel(p('a'), p('b'), 'CS2');
    const expired = await expireStaleChallenges(new Date(Date.now() + 48 * 3_600_000));
    expect(expired.map((x) => x.id)).toEqual([m.id]);
  });
});

describe('times', () => {
  it('2v2: capitão desafia, capitão adversário aceita, todos recebem ELO', async () => {
    const t1 = await createTeam('Alpha', p('a1'), [p('a2')]);
    const t2 = await createTeam('Bravo', p('b1'), [p('b2')]);
    const { match } = await createTeamChallenge('a1', t1.id, t2.id, 'Valorant');
    await expect(acceptDuel('b2', match.id)).rejects.toThrow(UserError); // só o capitão
    await acceptDuel('b1', match.id);
    await reportResult('a2', 'a1', match.id);
    const res = await confirmResult('b2', match.id);
    expect(res.winnerSide).toBe(1);
    const season = await getActiveSeason();
    const ranking = await getRanking(prisma, season.id, { mode: 'elo' });
    expect(
      ranking
        .filter((r) => r.rating === 1016)
        .map((r) => r.playerId)
        .sort(),
    ).toEqual(['a1', 'a2']);
  });

  it('times de tamanhos diferentes não podem se enfrentar', async () => {
    const t1 = await createTeam('Alpha', p('a1'), [p('a2')]);
    const t2 = await createTeam('Bravo', p('b1'), [p('b2'), p('b3')]);
    await expect(createTeamChallenge('a1', t1.id, t2.id, 'CS2')).rejects.toThrow(/mesmo tamanho/);
  });
});

describe('campeonato', () => {
  it('mata-mata com 5 jogadores: byes, avanço e campeão', async () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const t = await createTournament({ name: 'Copa', game: 'CS2', format: TournamentFormat.SINGLE_ELIM, teamSize: 1, createdById: 'adm' });
    for (const id of players) await register(t.id, p(id));
    await expect(register(t.id, p('p1'))).rejects.toThrow(/já está inscrito/);

    const progress = await startTournament(t.id);
    // 5 inscritos → chave de 8 → 1 partida real na 1ª rodada, 3 byes.
    expect(progress.readyMatchIds.length).toBeGreaterThanOrEqual(1);

    // Joga todas as partidas prontas até acabar; sempre vence o lado 1.
    let champion: string[] | null = null;
    for (let guard = 0; guard < 20 && !champion; guard++) {
      const ready = await prisma.match.findMany({
        where: { tournamentId: t.id, status: MatchStatus.ACCEPTED },
        include: { participants: true },
      });
      if (!ready.length) break;
      for (const m of ready) {
        const s1 = m.participants.find((x) => x.side === 1)!.playerId;
        const s2 = m.participants.find((x) => x.side === 2)!.playerId;
        await reportResult(s1, s1, m.id);
        const res = await confirmResult(s2, m.id);
        if (res.tournament?.finished) champion = res.tournament.finished.championIds;
      }
    }
    expect(champion).toHaveLength(1);
    const final = await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(final.status).toBe(TournamentStatus.FINISHED);
    const champ = await prisma.player.findUniqueOrThrow({ where: { id: champion![0] } });
    expect(champ.coins).toBeGreaterThanOrEqual(150);
    const ach = await prisma.playerAchievement.findMany({ where: { playerId: champion![0] } });
    expect(ach.map((a) => a.key)).toContain('tournament_champ');
  });

  it('todos contra todos termina quando todas as partidas acabam', async () => {
    const t = await createTournament({ name: 'Liga', game: 'CS2', format: TournamentFormat.ROUND_ROBIN, teamSize: 1, createdById: 'adm' });
    for (const id of ['x', 'y', 'z']) await register(t.id, p(id));
    const progress = await startTournament(t.id);
    expect(progress.readyMatchIds).toHaveLength(3);
    let finished = null;
    for (const id of progress.readyMatchIds) {
      const m = await prisma.match.findUniqueOrThrow({ where: { id }, include: { participants: true } });
      const ids = m.participants.map((x) => x.playerId);
      // "x" sempre vence; entre y e z, vence y.
      const winner = ids.includes('x') ? 'x' : 'y';
      const loser = ids.find((i) => i !== winner)!;
      await reportResult(winner, winner, id);
      const res = await confirmResult(loser, id);
      finished = res.tournament?.finished ?? finished;
    }
    expect(finished?.championIds).toEqual(['x']);
  });

  it('campeonato em times exige time do tamanho certo e capitão', async () => {
    await createTeam('Alpha', p('a1'), [p('a2')]);
    const t = await createTournament({
      name: 'Duplas',
      game: 'CS2',
      format: TournamentFormat.SINGLE_ELIM,
      teamSize: 2,
      createdById: 'adm',
    });
    await expect(register(t.id, p('a1'))).rejects.toThrow(/time/);
    await expect(register(t.id, p('a2'), 'Alpha')).rejects.toThrow(/capitão/);
    await register(t.id, p('a1'), 'Alpha');
  });
});

describe('temporada', () => {
  it('encerra, define campeão, paga prêmio e começa do zero', async () => {
    await playDuel('gustavo', 'lucas');
    await playDuel('gustavo', 'joao');
    const before = await getActiveSeason();
    const result = await endActiveSeason();
    expect(result.championId).toBe('gustavo');
    expect(result.newSeasonNumber).toBe(before.number + 1);

    const now = await getActiveSeason();
    expect(now.number).toBe(before.number + 1);
    expect(await getRanking(prisma, now.id)).toHaveLength(0);
    // Estatísticas antigas continuam arquivadas.
    expect(await getRanking(prisma, before.id)).toHaveLength(3);

    const g = await prisma.player.findUniqueOrThrow({ where: { id: 'gustavo' } });
    expect(g.coins).toBe(25 * 2 + 150);
  });
});

describe('perfil, rival e loja', () => {
  it('rivalidade e perfil', async () => {
    await playDuel('gustavo', 'lucas', 'Valorant');
    await playDuel('lucas', 'gustavo', 'Valorant');
    await playDuel('gustavo', 'lucas', 'CS2');
    await playDuel('gustavo', 'joao', 'CS2');

    const rivals = await getRivalries('gustavo');
    expect(rivals[0]).toMatchObject({ opponentId: 'lucas', total: 3, wins: 2, losses: 1 });

    const profile = await getProfile('gustavo');
    expect(profile!.stats.wins).toBe(3);
    expect(profile!.stats.losses).toBe(1);
    expect(profile!.winRate).toBe(75);
    expect(profile!.stats.streak).toBe(2);
    expect(profile!.position).toBe(1);
    expect(profile!.favoriteGames[0]).toBeDefined();
  });

  it('compra título com saldo e bloqueia sem saldo', async () => {
    await prisma.player.create({ data: { id: 'rich', username: 'rich' } });
    await expect(purchase(p('rich'), 'titulo-sniper')).rejects.toThrow(/Saldo insuficiente/);
    await addCoins(prisma, 'rich', 300, 'teste');
    const { balance } = await purchase(p('rich'), 'titulo-sniper');
    expect(balance).toBe(100);
    await expect(purchase(p('rich'), 'titulo-sniper')).rejects.toThrow(/já tem/);
  });
});
