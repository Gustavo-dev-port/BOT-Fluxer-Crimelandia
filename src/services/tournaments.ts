import type { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { type Db, prisma, transaction } from '../db.js';
import {
  advanceTarget,
  roundCount,
  roundRobin,
  roundRobinStandings,
  singleEliminationBracket,
} from '../lib/bracket.js';
import { MatchStatus, OPEN_STATUSES, type Side, TournamentFormat, TournamentStatus, UserError } from '../lib/types.js';
import { addCoins } from './economy.js';
import { ensurePlayer, type PlayerRef } from './players.js';
import { getActiveSeason } from './seasons.js';

type Tx = Prisma.TransactionClient;
type EntryWithTeam = Prisma.TournamentEntryGetPayload<{ include: { team: { include: { members: true } } } }>;

export interface TournamentProgress {
  tournamentId: number;
  /** Partidas que acabaram de ficar prontas para jogar. */
  readyMatchIds: number[];
  finished: { winnerEntryId: number; championIds: string[] } | null;
}

export async function getTournament(db: Db, id: number) {
  const t = await db.tournament.findUnique({
    where: { id },
    include: { entries: { include: { team: { include: { members: true } } }, orderBy: { id: 'asc' } } },
  });
  if (!t) throw new UserError(`Campeonato #${id} não encontrado.`);
  return t;
}

export function entryPlayerIds(entry: EntryWithTeam): string[] {
  if (entry.playerId) return [entry.playerId];
  return entry.team?.members.map((m) => m.playerId) ?? [];
}

export function entryLabel(entry: EntryWithTeam): string {
  return entry.team ? `**${entry.team.name}**` : `<@${entry.playerId}>`;
}

export async function createTournament(input: {
  name: string;
  game: string;
  format: TournamentFormat;
  teamSize: number;
  createdById: string;
  isWeekly?: boolean;
  closesAt?: Date;
}) {
  if (input.teamSize < 1 || input.teamSize > 10) throw new UserError('O tamanho do time deve ser entre 1 e 10.');
  return prisma.tournament.create({
    data: {
      name: input.name,
      game: input.game,
      format: input.format,
      teamSize: input.teamSize,
      createdById: input.createdById,
      isWeekly: input.isWeekly ?? false,
      closesAt: input.closesAt,
    },
  });
}

export async function listTournaments(statuses: string[] = [TournamentStatus.REGISTRATION, TournamentStatus.RUNNING]) {
  return prisma.tournament.findMany({
    where: { status: { in: statuses } },
    include: { _count: { select: { entries: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Inscreve um jogador (campeonato solo) ou o time do capitão (campeonato em times). */
export async function register(tournamentId: number, user: PlayerRef, teamName?: string | null) {
  return transaction(async (tx) => {
    const t = await getTournament(tx, tournamentId);
    if (t.status !== TournamentStatus.REGISTRATION) throw new UserError('As inscrições deste campeonato estão fechadas.');
    await ensurePlayer(tx, user);

    const alreadyIn = new Set(t.entries.flatMap(entryPlayerIds));

    if (t.teamSize === 1) {
      if (alreadyIn.has(user.id)) throw new UserError('Você já está inscrito neste campeonato.');
      await tx.tournamentEntry.create({ data: { tournamentId, playerId: user.id } });
      return { tournament: t, label: `<@${user.id}>` };
    }

    if (!teamName) throw new UserError(`Este campeonato é em times de ${t.teamSize}. Informe a opção \`time\`.`);
    const team = await tx.team.findUnique({ where: { name: teamName }, include: { members: true } });
    if (!team) throw new UserError(`Time **${teamName}** não encontrado.`);
    if (team.captainId !== user.id) throw new UserError('Só o capitão pode inscrever o time.');
    if (team.members.length !== t.teamSize) {
      throw new UserError(`O time precisa ter exatamente ${t.teamSize} jogadores (tem ${team.members.length}).`);
    }
    const clash = team.members.find((m) => alreadyIn.has(m.playerId));
    if (clash) throw new UserError(`<@${clash.playerId}> já está inscrito por outro time.`);
    await tx.tournamentEntry.create({ data: { tournamentId, teamId: team.id } });
    return { tournament: t, label: `**${team.name}**` };
  });
}

export async function unregister(tournamentId: number, userId: string) {
  const t = await getTournament(prisma, tournamentId);
  if (t.status !== TournamentStatus.REGISTRATION) throw new UserError('As inscrições deste campeonato estão fechadas.');
  const entry = t.entries.find((e) => e.playerId === userId || e.team?.captainId === userId);
  if (!entry) throw new UserError('Você não tem inscrição (ou não é capitão do time inscrito) neste campeonato.');
  await prisma.tournamentEntry.delete({ where: { id: entry.id } });
  return t;
}

/** Rating médio da inscrição, usado para definir os seeds. */
async function entryRating(tx: Tx, entry: EntryWithTeam, seasonId: number): Promise<number> {
  const ids = entryPlayerIds(entry);
  const stats = await tx.playerSeasonStats.findMany({ where: { seasonId, playerId: { in: ids } } });
  const ratings = ids.map((id) => stats.find((s) => s.playerId === id)?.rating ?? config.elo.initial);
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

async function makeReady(tx: Tx, matchId: number, entries: EntryWithTeam[], entry1Id: number, entry2Id: number) {
  const e1 = entries.find((e) => e.id === entry1Id)!;
  const e2 = entries.find((e) => e.id === entry2Id)!;
  await tx.match.update({
    where: { id: matchId },
    data: {
      status: MatchStatus.ACCEPTED,
      acceptedAt: new Date(),
      entry1Id,
      entry2Id,
      team1Id: e1.teamId,
      team2Id: e2.teamId,
      participants: {
        create: [
          ...entryPlayerIds(e1).map((playerId) => ({ playerId, side: 1 })),
          ...entryPlayerIds(e2).map((playerId) => ({ playerId, side: 2 })),
        ],
      },
    },
  });
}

/** Fecha inscrições, define seeds pelo rating e gera a chave. */
export async function startTournament(tournamentId: number): Promise<TournamentProgress> {
  return transaction(async (tx) => {
    const t = await getTournament(tx, tournamentId);
    if (t.status !== TournamentStatus.REGISTRATION) throw new UserError('Este campeonato já começou ou foi encerrado.');
    if (t.entries.length < 2) throw new UserError('São necessários pelo menos 2 inscritos para começar.');

    const season = await getActiveSeason(tx);
    const rated = await Promise.all(t.entries.map(async (e) => ({ e, r: await entryRating(tx, e, season.id) })));
    rated.sort((a, b) => b.r - a.r || a.e.id - b.e.id);
    const seeded = rated.map((x) => x.e);
    for (const [i, e] of seeded.entries()) await tx.tournamentEntry.update({ where: { id: e.id }, data: { seed: i + 1 } });

    await tx.tournament.update({ where: { id: t.id }, data: { status: TournamentStatus.RUNNING, startedAt: new Date() } });

    const ids = seeded.map((e) => e.id);
    const progress: TournamentProgress = { tournamentId: t.id, readyMatchIds: [], finished: null };
    const base = { seasonId: season.id, game: t.game, tournamentId: t.id };

    if (t.format === TournamentFormat.ROUND_ROBIN) {
      for (const slot of roundRobin(ids)) {
        const m = await tx.match.create({ data: { ...base, status: MatchStatus.WAITING, round: slot.round, slot: slot.slot } });
        await makeReady(tx, m.id, seeded, slot.entry1!, slot.entry2!);
        progress.readyMatchIds.push(m.id);
      }
      return progress;
    }

    const bracket = singleEliminationBracket(ids);
    const created = new Map<string, number>();
    for (const slot of bracket) {
      const m = await tx.match.create({
        data: { ...base, status: MatchStatus.WAITING, round: slot.round, slot: slot.slot, entry1Id: slot.entry1, entry2Id: slot.entry2 },
      });
      created.set(`${slot.round}:${slot.slot}`, m.id);
    }

    // Primeira rodada: partidas completas ficam prontas; byes avançam direto.
    for (const slot of bracket.filter((s) => s.round === 1)) {
      const matchId = created.get(`1:${slot.slot}`)!;
      if (slot.entry1 !== null && slot.entry2 !== null) {
        await makeReady(tx, matchId, seeded, slot.entry1, slot.entry2);
        progress.readyMatchIds.push(matchId);
      } else {
        const winner = (slot.entry1 ?? slot.entry2)!;
        await tx.match.update({
          where: { id: matchId },
          data: { status: MatchStatus.CONFIRMED, winnerSide: slot.entry1 !== null ? 1 : 2, confirmedAt: new Date() },
        });
        await advanceWinner(tx, t.id, 1, slot.slot, winner, seeded, progress);
      }
    }
    return progress;
  });
}

async function advanceWinner(
  tx: Tx,
  tournamentId: number,
  round: number,
  slot: number,
  winnerEntryId: number,
  entries: EntryWithTeam[],
  progress: TournamentProgress,
) {
  const total = roundCount(entries.length);
  if (round >= total) {
    progress.finished = await finishTournament(tx, tournamentId, winnerEntryId, entries);
    return;
  }
  const target = advanceTarget(round, slot);
  const next = await tx.match.findFirstOrThrow({ where: { tournamentId, round: target.round, slot: target.slot } });
  const data = target.position === 1 ? { entry1Id: winnerEntryId } : { entry2Id: winnerEntryId };
  const updated = await tx.match.update({ where: { id: next.id }, data });
  if (updated.entry1Id !== null && updated.entry2Id !== null) {
    await makeReady(tx, updated.id, entries, updated.entry1Id, updated.entry2Id);
    progress.readyMatchIds.push(updated.id);
  }
}

async function finishTournament(tx: Tx, tournamentId: number, winnerEntryId: number, entries: EntryWithTeam[]) {
  const t = await tx.tournament.update({
    where: { id: tournamentId },
    data: { status: TournamentStatus.FINISHED, winnerEntryId, finishedAt: new Date() },
  });
  const winner = entries.find((e) => e.id === winnerEntryId)!;
  const championIds = entryPlayerIds(winner);
  for (const id of championIds) await addCoins(tx, id, config.coins.champion, `Campeão de ${t.name}`);
  if (t.isWeekly) {
    // Evento especial: bônus para todos os participantes.
    for (const id of entries.flatMap(entryPlayerIds)) await addCoins(tx, id, config.coins.specialEvent, `Participação em ${t.name}`);
  }
  return { winnerEntryId, championIds };
}

/** Chamado dentro da transação de confirmação de uma partida de campeonato. */
export async function onTournamentMatchConfirmed(
  tx: Tx,
  match: { id: number; tournamentId: number | null; round: number | null; slot: number | null; entry1Id: number | null; entry2Id: number | null },
  winnerSide: Side,
): Promise<TournamentProgress> {
  const t = await getTournament(tx, match.tournamentId!);
  const progress: TournamentProgress = { tournamentId: t.id, readyMatchIds: [], finished: null };
  if (t.status !== TournamentStatus.RUNNING) return progress;
  const winnerEntryId = (winnerSide === 1 ? match.entry1Id : match.entry2Id)!;

  if (t.format === TournamentFormat.SINGLE_ELIM) {
    await advanceWinner(tx, t.id, match.round!, match.slot!, winnerEntryId, t.entries, progress);
    return progress;
  }

  const open = await tx.match.count({ where: { tournamentId: t.id, status: { in: OPEN_STATUSES } } });
  if (open === 0) {
    const standings = await roundRobinTable(tx, t.id, t.entries.map((e) => e.id));
    progress.finished = await finishTournament(tx, t.id, standings[0].entry, t.entries);
  }
  return progress;
}

export async function roundRobinTable(db: Db, tournamentId: number, entryIds: number[]) {
  const done = await db.match.findMany({ where: { tournamentId, status: MatchStatus.CONFIRMED } });
  const results = done.map((m) => ({
    winner: (m.winnerSide === 1 ? m.entry1Id : m.entry2Id)!,
    loser: (m.winnerSide === 1 ? m.entry2Id : m.entry1Id)!,
  }));
  return roundRobinStandings(entryIds, results);
}

export async function cancelTournament(tournamentId: number) {
  return transaction(async (tx) => {
    const t = await getTournament(tx, tournamentId);
    if (t.status === TournamentStatus.FINISHED || t.status === TournamentStatus.CANCELLED) {
      throw new UserError('Este campeonato já foi encerrado.');
    }
    await tx.match.updateMany({
      where: { tournamentId, status: { in: [...OPEN_STATUSES, MatchStatus.WAITING] } },
      data: { status: MatchStatus.CANCELLED },
    });
    return tx.tournament.update({ where: { id: tournamentId }, data: { status: TournamentStatus.CANCELLED } });
  });
}

export async function tournamentMatches(tournamentId: number) {
  return prisma.match.findMany({
    where: { tournamentId },
    include: { participants: true },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  });
}

/** Eventos semanais cujo prazo de inscrição acabou. */
export async function dueWeeklyEvents(now = new Date()) {
  return prisma.tournament.findMany({
    where: { isWeekly: true, status: TournamentStatus.REGISTRATION, closesAt: { lte: now } },
  });
}

export async function findByMessage(messageId: string) {
  return prisma.tournament.findFirst({ where: { messageId } });
}
