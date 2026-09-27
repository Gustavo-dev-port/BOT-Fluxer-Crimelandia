import type { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { type Db, prisma, transaction } from '../database/client.js';
import type { Achievement } from './rules/achievements.js';
import { teamEloDelta } from './rules/elo.js';
import { MatchStatus, OPEN_STATUSES, type Side, UserError } from '../types/domain.js';
import { checkAchievements } from './achievements.js';
import { addCoins } from './economy.js';
import { ensurePlayer, ensureStats, type PlayerRef } from './players.js';
import { getActiveSeason } from './seasons.js';
import { onTournamentMatchConfirmed, type TournamentProgress } from './tournaments.js';

export type MatchWithParticipants = Prisma.MatchGetPayload<{ include: { participants: true } }>;

export function sideOf(match: MatchWithParticipants, playerId: string): Side | null {
  const p = match.participants.find((x) => x.playerId === playerId);
  return p ? (p.side as Side) : null;
}

export function playersOnSide(match: MatchWithParticipants, side: Side): string[] {
  return match.participants.filter((p) => p.side === side).map((p) => p.playerId);
}

const otherSide = (side: Side): Side => (side === 1 ? 2 : 1);

export async function getMatch(db: Db, id: number): Promise<MatchWithParticipants> {
  const match = await db.match.findUnique({ where: { id }, include: { participants: true } });
  if (!match) throw new UserError(`Partida #${id} não encontrada.`);
  return match;
}

/**
 * Resolve qual partida o usuário quer: a informada, ou a mais recente que
 * satisfaça o filtro. Se houver mais de uma, pede o ID.
 */
async function resolveMatch(
  db: Db,
  userId: string,
  matchId: number | null | undefined,
  statuses: string[],
  filter: (m: MatchWithParticipants) => boolean,
  what: string,
): Promise<MatchWithParticipants> {
  if (matchId) {
    const match = await getMatch(db, matchId);
    if (!statuses.includes(match.status) || !filter(match)) {
      throw new UserError(`A partida #${matchId} não está disponível para ${what}.`);
    }
    return match;
  }
  const candidates = (
    await db.match.findMany({
      where: { status: { in: statuses }, participants: { some: { playerId: userId } } },
      include: { participants: true },
      orderBy: { createdAt: 'desc' },
    })
  ).filter(filter);
  if (candidates.length === 0) throw new UserError(`Você não tem nenhuma partida disponível para ${what}.`);
  if (candidates.length > 1) {
    const ids = candidates.map((c) => `#${c.id}`).join(', ');
    throw new UserError(`Você tem várias partidas (${ids}). Informe o ID na opção \`partida\`.`);
  }
  return candidates[0];
}

// ─── Criação ────────────────────────────────────────────────────────────────

export async function createDuel(challenger: PlayerRef, opponent: PlayerRef, game: string) {
  if (challenger.id === opponent.id) throw new UserError('Você não pode desafiar a si mesmo.');
  return transaction(async (tx) => {
    await ensurePlayer(tx, challenger);
    await ensurePlayer(tx, opponent);
    const existing = await tx.match.findFirst({
      where: {
        status: { in: OPEN_STATUSES },
        tournamentId: null,
        team1Id: null,
        AND: [{ participants: { some: { playerId: challenger.id } } }, { participants: { some: { playerId: opponent.id } } }],
      },
    });
    if (existing) throw new UserError(`Já existe uma disputa aberta entre vocês (partida #${existing.id}).`);

    const season = await getActiveSeason(tx);
    return tx.match.create({
      data: {
        seasonId: season.id,
        game,
        status: MatchStatus.PENDING,
        challengerId: challenger.id,
        participants: {
          create: [
            { playerId: challenger.id, side: 1 },
            { playerId: opponent.id, side: 2 },
          ],
        },
      },
      include: { participants: true },
    });
  });
}

export async function createTeamChallenge(requesterId: string, team1Id: number, team2Id: number, game: string) {
  if (team1Id === team2Id) throw new UserError('Um time não pode desafiar a si mesmo.');
  return transaction(async (tx) => {
    const [t1, t2] = await Promise.all([
      tx.team.findUnique({ where: { id: team1Id }, include: { members: true } }),
      tx.team.findUnique({ where: { id: team2Id }, include: { members: true } }),
    ]);
    if (!t1 || !t2) throw new UserError('Time não encontrado.');
    if (t1.captainId !== requesterId) throw new UserError(`Só o capitão de **${t1.name}** pode lançar desafios.`);
    if (t1.members.length !== t2.members.length) {
      throw new UserError(`Os times precisam ter o mesmo tamanho (${t1.members.length} vs ${t2.members.length}).`);
    }
    const ids1 = new Set(t1.members.map((m) => m.playerId));
    if (t2.members.some((m) => ids1.has(m.playerId))) throw new UserError('Os times têm jogadores em comum.');

    const existing = await tx.match.findFirst({
      where: {
        status: { in: OPEN_STATUSES },
        OR: [
          { team1Id, team2Id },
          { team1Id: team2Id, team2Id: team1Id },
        ],
      },
    });
    if (existing) throw new UserError(`Já existe uma disputa aberta entre esses times (partida #${existing.id}).`);

    const season = await getActiveSeason(tx);
    const match = await tx.match.create({
      data: {
        seasonId: season.id,
        game,
        status: MatchStatus.PENDING,
        challengerId: requesterId,
        team1Id,
        team2Id,
        participants: {
          create: [
            ...t1.members.map((m) => ({ playerId: m.playerId, side: 1 })),
            ...t2.members.map((m) => ({ playerId: m.playerId, side: 2 })),
          ],
        },
      },
      include: { participants: true },
    });
    return { match, team1: t1, team2: t2 };
  });
}

// ─── Aceite ─────────────────────────────────────────────────────────────────

/** Quem pode responder ao desafio: o adversário (1v1) ou o capitão do time desafiado. */
async function canRespond(db: Db, match: MatchWithParticipants, userId: string): Promise<boolean> {
  if (match.team2Id) {
    const team = await db.team.findUnique({ where: { id: match.team2Id } });
    return team?.captainId === userId;
  }
  return sideOf(match, userId) === 2;
}

async function resolvePending(db: Db, userId: string, matchId?: number | null) {
  const pending = matchId
    ? [await getMatch(db, matchId)]
    : await db.match.findMany({
        where: { status: MatchStatus.PENDING, participants: { some: { playerId: userId } } },
        include: { participants: true },
        orderBy: { createdAt: 'desc' },
      });
  const allowed: MatchWithParticipants[] = [];
  for (const m of pending) if (m.status === MatchStatus.PENDING && (await canRespond(db, m, userId))) allowed.push(m);
  if (allowed.length === 0) throw new UserError('Você não tem nenhum desafio pendente para responder.');
  if (allowed.length > 1) {
    throw new UserError(`Você tem vários desafios (${allowed.map((m) => `#${m.id}`).join(', ')}). Informe o ID na opção \`partida\`.`);
  }
  return allowed[0];
}

export async function acceptDuel(userId: string, matchId?: number | null) {
  const match = await resolvePending(prisma, userId, matchId);
  return prisma.match.update({
    where: { id: match.id },
    data: { status: MatchStatus.ACCEPTED, acceptedAt: new Date() },
    include: { participants: true },
  });
}

export async function declineDuel(userId: string, matchId?: number | null) {
  const match = await resolvePending(prisma, userId, matchId);
  return prisma.match.update({
    where: { id: match.id },
    data: { status: MatchStatus.DECLINED },
    include: { participants: true },
  });
}

export async function cancelDuel(userId: string, matchId: number | null | undefined, isAdmin: boolean) {
  const match = await resolveMatch(
    prisma,
    userId,
    matchId,
    isAdmin ? [MatchStatus.PENDING, MatchStatus.ACCEPTED, MatchStatus.AWAITING_CONFIRMATION, MatchStatus.DISPUTED] : [MatchStatus.PENDING],
    (m) => m.tournamentId === null && (isAdmin || m.challengerId === userId),
    'cancelar',
  );
  return prisma.match.update({ where: { id: match.id }, data: { status: MatchStatus.CANCELLED }, include: { participants: true } });
}

// ─── Resultado ──────────────────────────────────────────────────────────────

/** Tempo entre o aceite e agora, em segundos (null se a partida não tem aceite). */
export function measuredDuration(match: { acceptedAt: Date | null }, now: Date): number | null {
  if (!match.acceptedAt) return null;
  return Math.max(0, Math.round((now.getTime() - match.acceptedAt.getTime()) / 1000));
}

export interface ConfirmedMatch {
  match: MatchWithParticipants;
  winnerSide: Side;
  delta: number;
  unlocked: { playerId: string; achievements: Achievement[] }[];
  tournament: TournamentProgress | null;
}

export type ReportOutcome =
  | { kind: 'awaiting'; match: MatchWithParticipants }
  | { kind: 'confirmed'; result: ConfirmedMatch }
  | { kind: 'disputed'; match: MatchWithParticipants };

/**
 * Registra o resultado. Fica pendente até o outro lado confirmar — assim uma
 * pessoa sozinha não consegue registrar vitória. Se o outro lado também usar
 * !resultado, o mesmo vencedor confirma e um vencedor diferente abre disputa.
 */
export async function reportResult(
  userId: string,
  winnerId: string,
  matchId?: number | null,
  /** Duração informada pelo jogador; sem ela, mede do aceite até agora. */
  durationSeconds?: number | null,
): Promise<ReportOutcome> {
  return transaction(async (tx) => {
    const match = await resolveMatch(
      tx,
      userId,
      matchId,
      [MatchStatus.ACCEPTED, MatchStatus.AWAITING_CONFIRMATION],
      (m) => sideOf(m, userId) !== null,
      'registrar resultado',
    );
    const reporterSide = sideOf(match, userId)!;
    const winnerSide = sideOf(match, winnerId);
    if (!winnerSide) throw new UserError('O vencedor precisa ser um dos participantes da partida.');

    if (match.status === MatchStatus.AWAITING_CONFIRMATION) {
      if (match.reportedSide === reporterSide) {
        throw new UserError(`Seu lado já registrou o resultado da partida #${match.id}. Aguarde a confirmação do adversário.`);
      }
      if (match.winnerSide === winnerSide) {
        return { kind: 'confirmed', result: await finalizeMatch(tx, match, winnerSide) };
      }
      const disputed = await tx.match.update({
        where: { id: match.id },
        data: { status: MatchStatus.DISPUTED },
        include: { participants: true },
      });
      return { kind: 'disputed', match: disputed };
    }

    const now = new Date();
    const updated = await tx.match.update({
      where: { id: match.id },
      data: {
        status: MatchStatus.AWAITING_CONFIRMATION,
        reportedById: userId,
        reportedSide: reporterSide,
        winnerSide,
        reportedAt: now,
        durationSeconds: durationSeconds ?? measuredDuration(match, now),
      },
      include: { participants: true },
    });
    return { kind: 'awaiting', match: updated };
  });
}

const awaitingFromOtherSide = (userId: string) => (m: MatchWithParticipants) => {
  const side = sideOf(m, userId);
  return side !== null && m.reportedSide !== null && side !== m.reportedSide;
};

export async function confirmResult(userId: string, matchId?: number | null): Promise<ConfirmedMatch> {
  return transaction(async (tx) => {
    const match = await resolveMatch(tx, userId, matchId, [MatchStatus.AWAITING_CONFIRMATION], awaitingFromOtherSide(userId), 'confirmar');
    return finalizeMatch(tx, match, match.winnerSide as Side);
  });
}

export async function disputeResult(userId: string, matchId?: number | null) {
  const match = await resolveMatch(
    prisma,
    userId,
    matchId,
    [MatchStatus.AWAITING_CONFIRMATION],
    awaitingFromOtherSide(userId),
    'contestar',
  );
  return prisma.match.update({ where: { id: match.id }, data: { status: MatchStatus.DISPUTED }, include: { participants: true } });
}

/** Resultado definido por um admin (disputas, partidas travadas). */
export async function adminSetResult(matchId: number, winnerId: string): Promise<ConfirmedMatch> {
  return transaction(async (tx) => {
    const match = await getMatch(tx, matchId);
    if (![MatchStatus.ACCEPTED, MatchStatus.AWAITING_CONFIRMATION, MatchStatus.DISPUTED].includes(match.status as never)) {
      throw new UserError(`A partida #${matchId} está com status ${match.status} e não pode receber resultado.`);
    }
    const side = sideOf(match, winnerId);
    if (!side) throw new UserError('O vencedor precisa ser um dos participantes da partida.');
    return finalizeMatch(tx, match, side);
  });
}

/** Aplica ELO, pontos, moedas, conquistas e avanço de chave. */
async function finalizeMatch(tx: Prisma.TransactionClient, match: MatchWithParticipants, winnerSide: Side): Promise<ConfirmedMatch> {
  const now = new Date();
  const season = await getActiveSeason(tx);
  const loserSide = otherSide(winnerSide);

  const stats = new Map<string, Awaited<ReturnType<typeof ensureStats>>>();
  for (const p of match.participants) stats.set(p.playerId, await ensureStats(tx, p.playerId, season.id));

  const ratingsOf = (side: Side) => playersOnSide(match, side).map((id) => stats.get(id)!.rating);
  const winnerRatings = ratingsOf(winnerSide);
  const loserRatings = ratingsOf(loserSide);
  const delta = teamEloDelta(winnerRatings, loserRatings, config.elo.kFactor);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ratingGap = Math.round(avg(loserRatings) - avg(winnerRatings));

  const unlocked: ConfirmedMatch['unlocked'] = [];
  for (const p of match.participants) {
    const s = stats.get(p.playerId)!;
    const won = p.side === winnerSide;
    const newStreak = won ? s.streak + 1 : 0;
    await tx.playerSeasonStats.update({
      where: { id: s.id },
      data: won
        ? {
            rating: s.rating + delta,
            points: { increment: config.points.win },
            wins: { increment: 1 },
            streak: newStreak,
            bestStreak: Math.max(s.bestStreak, newStreak),
          }
        : { rating: s.rating - delta, points: { increment: config.points.loss }, losses: { increment: 1 }, streak: 0 },
    });
    await tx.matchParticipant.update({
      where: { id: p.id },
      data: { ratingBefore: s.rating, ratingDelta: won ? delta : -delta },
    });
    await addCoins(
      tx,
      p.playerId,
      won ? config.coins.win : config.coins.participation,
      won ? `Vitória na partida #${match.id}` : `Participação na partida #${match.id}`,
    );
    const achievements = await checkAchievements(tx, p.playerId, {
      currentStreak: newStreak,
      lastWinRatingGap: won ? ratingGap : undefined,
    });
    if (achievements.length) unlocked.push({ playerId: p.playerId, achievements });
  }

  const updated = await tx.match.update({
    where: { id: match.id },
    data: {
      status: MatchStatus.CONFIRMED,
      winnerSide,
      confirmedAt: now,
      seasonId: season.id,
      durationSeconds: match.durationSeconds ?? measuredDuration(match, now),
    },
    include: { participants: true },
  });

  const tournament = updated.tournamentId ? await onTournamentMatchConfirmed(tx, updated, winnerSide) : null;
  if (tournament?.finished) {
    for (const playerId of tournament.finished.championIds) {
      const achievements = await checkAchievements(tx, playerId);
      if (achievements.length) unlocked.push({ playerId, achievements });
    }
  }

  return { match: updated, winnerSide, delta, unlocked, tournament };
}

// ─── Manutenção ─────────────────────────────────────────────────────────────

/** Expira desafios pendentes antigos. Retorna as partidas expiradas. */
export async function expireStaleChallenges(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.duel.pendingExpiryHours * 3_600_000);
  const stale = await prisma.match.findMany({
    where: { status: MatchStatus.PENDING, createdAt: { lt: cutoff } },
    include: { participants: true },
  });
  if (stale.length) {
    await prisma.match.updateMany({ where: { id: { in: stale.map((m) => m.id) } }, data: { status: MatchStatus.EXPIRED } });
  }
  return stale;
}

export async function listOpenMatches(userId: string) {
  return prisma.match.findMany({
    where: { status: { in: OPEN_STATUSES }, participants: { some: { playerId: userId } } },
    include: { participants: true },
    orderBy: { createdAt: 'desc' },
  });
}
