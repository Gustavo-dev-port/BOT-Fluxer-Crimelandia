/**
 * Night Fluxer: evento semanal com votação do jogo, inscrição, sorteio de
 * equipes e salas de voz. A chave, os resultados e o ranking usam o campeonato
 * (Tournament) ligado ao evento.
 */
import type { EventTeam, WeeklyEvent } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { prisma, transaction } from '../database/client.js';
import { MatchStatus, TournamentFormat, TournamentStatus, UserError } from '../types/domain.js';
import { listGames } from './games.js';
import { ensurePlayer, type PlayerRef } from './players.js';
import { drawTeams, pollOptions, TEAM_NAMES, winningOption } from './rules/night.js';
import { createTournament, getTournament } from './tournaments.js';

export const NightStatus = {
  VOTING: 'VOTING',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
  CANCELLED: 'CANCELLED',
} as const;

const DAY = 86_400_000;
/** Jogo do campeonato enquanto a votação não termina. */
export const PENDING_GAME = 'Em votação';

export function optionsOf(event: Pick<WeeklyEvent, 'options'>): string[] {
  return JSON.parse(event.options) as string[];
}

/** Cria o campeonato do Night Fluxer (individual durante a inscrição) e a votação. */
export async function createNightEvent(createdById = 'bot', now = new Date()) {
  const games = (await listGames()).map((g) => g.name);
  const recent = await prisma.match.groupBy({
    by: ['game'],
    where: { status: MatchStatus.CONFIRMED, confirmedAt: { gte: new Date(now.getTime() - 30 * DAY) } },
    _count: { _all: true },
  });
  const options = pollOptions(games, new Map(recent.map((r) => [r.game, r._count._all])), config.weeklyEvent.pollOptions);
  const closesAt = new Date(now.getTime() + config.weeklyEvent.registrationMinutes * 60_000);
  const tournament = await createTournament({
    name: config.weeklyEvent.name,
    // Sem opções, não há votação: usa o jogo configurado.
    game: options.length ? PENDING_GAME : config.weeklyEvent.game,
    format: TournamentFormat.SINGLE_ELIM,
    teamSize: 1,
    createdById,
    isWeekly: true,
    closesAt,
  });
  const event = await prisma.weeklyEvent.create({ data: { tournamentId: tournament.id, options: JSON.stringify(options), closesAt } });
  return { tournament, event };
}

export function nightByTournament(tournamentId: number) {
  return prisma.weeklyEvent.findUnique({ where: { tournamentId }, include: { votes: true, teams: true } });
}

export async function nightByMessage(messageId: string) {
  const tournament = await prisma.tournament.findFirst({ where: { messageId } });
  return tournament ? nightByTournament(tournament.id) : null;
}

/** O Night Fluxer mais recente (em andamento, ou o último que aconteceu). */
export async function latestNight() {
  return prisma.weeklyEvent.findFirst({ orderBy: { id: 'desc' }, include: { votes: true, teams: true, tournament: true } });
}

/** Vota (ou troca o voto) num jogo. */
export async function castVote(eventId: number, player: PlayerRef, option: number) {
  const event = await prisma.weeklyEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.status !== NightStatus.VOTING) throw new UserError('A votação deste Night Fluxer já terminou.');
  if (option < 0 || option >= optionsOf(event).length) throw new UserError('Opção inválida.');
  await ensurePlayer(prisma, player);
  return prisma.eventVote.upsert({
    where: { weeklyEventId_playerId: { weeklyEventId: eventId, playerId: player.id } },
    create: { weeklyEventId: eventId, playerId: player.id, option },
    update: { option },
  });
}

/** Tirar a reação desfaz o voto (se ainda for nessa opção). */
export async function removeVote(eventId: number, playerId: string, option: number) {
  await prisma.eventVote.deleteMany({ where: { weeklyEventId: eventId, playerId, option, weeklyEvent: { status: NightStatus.VOTING } } });
}

export interface ClosedNight {
  event: WeeklyEvent;
  game: string;
  /** Equipes (ou a arena única, no 1v1), ainda sem sala de voz. */
  teams: (EventTeam & { memberIds: string[] })[];
}

/**
 * Fecha votação e inscrição: define o jogo, sorteia as equipes e deixa o
 * campeonato pronto para começar. Com menos de 2 inscritos, lança UserError.
 */
export async function closeNight(eventId: number, rand: () => number = Math.random): Promise<ClosedNight> {
  return transaction(async (tx) => {
    const event = await tx.weeklyEvent.findUniqueOrThrow({ where: { id: eventId }, include: { votes: true } });
    if (event.status !== NightStatus.VOTING) throw new UserError('Este Night Fluxer já foi fechado.');
    const t = await getTournament(tx, event.tournamentId);
    const players = t.entries.map((e) => e.playerId).filter((id): id is string => Boolean(id));
    if (players.length < 2) throw new UserError('São necessários pelo menos 2 inscritos para começar.');

    const options = optionsOf(event);
    const game = options.length
      ? options[
          winningOption(
            options.length,
            event.votes.map((v) => v.option),
          )
        ]
      : t.game;

    const drawn = drawTeams(players, config.weeklyEvent.teamSize, rand);
    const teams: ClosedNight['teams'] = [];
    if (drawn) {
      await tx.tournamentEntry.deleteMany({ where: { tournamentId: t.id } });
      for (const [i, memberIds] of drawn.entries()) {
        const name = TEAM_NAMES[i % TEAM_NAMES.length] + (i >= TEAM_NAMES.length ? ` ${Math.floor(i / TEAM_NAMES.length) + 1}` : '');
        const team = await tx.team.create({
          data: {
            name: `Night #${event.id} · ${name}`,
            captainId: memberIds[0],
            members: { create: memberIds.map((playerId) => ({ playerId })) },
          },
        });
        await tx.tournamentEntry.create({ data: { tournamentId: t.id, teamId: team.id } });
        const eventTeam = await tx.eventTeam.create({ data: { weeklyEventId: event.id, teamId: team.id, name } });
        teams.push({ ...eventTeam, memberIds });
      }
    } else {
      // 1v1: uma sala de voz única para todos os inscritos.
      const arena = await tx.eventTeam.create({ data: { weeklyEventId: event.id, name: 'Arena' } });
      teams.push({ ...arena, memberIds: players });
    }

    await tx.tournament.update({ where: { id: t.id }, data: { game, teamSize: drawn ? config.weeklyEvent.teamSize : 1 } });
    const updated = await tx.weeklyEvent.update({ where: { id: event.id }, data: { status: NightStatus.RUNNING, game } });
    return { event: updated, game, teams };
  });
}

export function setTeamVoiceChannel(eventTeamId: number, channelId: string) {
  return prisma.eventTeam.update({ where: { id: eventTeamId }, data: { voiceChannelId: channelId } });
}

/**
 * Eventos em andamento cujo campeonato já terminou (ou foi cancelado): marca como
 * encerrados e devolve as salas de voz para apagar.
 */
export async function settleEndedNights(now = new Date()) {
  const open = await prisma.weeklyEvent.findMany({
    where: {
      status: { in: [NightStatus.VOTING, NightStatus.RUNNING] },
      tournament: { status: { in: [TournamentStatus.FINISHED, TournamentStatus.CANCELLED] } },
    },
    include: { teams: true, tournament: true },
  });
  const ended: { event: WeeklyEvent; voiceChannelIds: string[] }[] = [];
  for (const e of open) {
    const status = e.tournament.status === TournamentStatus.FINISHED ? NightStatus.FINISHED : NightStatus.CANCELLED;
    const event = await prisma.weeklyEvent.update({ where: { id: e.id }, data: { status, finishedAt: now } });
    ended.push({ event, voiceChannelIds: e.teams.map((t) => t.voiceChannelId).filter((id): id is string => Boolean(id)) });
  }
  return ended;
}
