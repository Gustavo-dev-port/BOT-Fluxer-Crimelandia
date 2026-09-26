import { prisma, transaction } from '../db.js';
import { OPEN_STATUSES, UserError } from '../lib/types.js';
import { ensurePlayer, type PlayerRef } from './players.js';

export const MAX_TEAM_SIZE = 10;

export async function createTeam(name: string, captain: PlayerRef, members: PlayerRef[]) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 32) throw new UserError('O nome do time deve ter entre 2 e 32 caracteres.');
  const all = new Map<string, PlayerRef>([[captain.id, captain], ...members.map((m) => [m.id, m] as const)]);
  if (all.size < 2) throw new UserError('Um time precisa de pelo menos 2 jogadores.');
  if (all.size > MAX_TEAM_SIZE) throw new UserError(`Um time pode ter no máximo ${MAX_TEAM_SIZE} jogadores.`);

  return transaction(async (tx) => {
    if (await tx.team.findUnique({ where: { name: trimmed } })) throw new UserError(`Já existe um time chamado **${trimmed}**.`);
    for (const p of all.values()) await ensurePlayer(tx, p);
    return tx.team.create({
      data: {
        name: trimmed,
        captainId: captain.id,
        members: { create: [...all.keys()].map((playerId) => ({ playerId })) },
      },
      include: { members: true },
    });
  });
}

export async function getTeamByName(name: string) {
  const team = await prisma.team.findUnique({ where: { name: name.trim() }, include: { members: true } });
  if (!team) throw new UserError(`Time **${name}** não encontrado.`);
  return team;
}

export async function listTeams(playerId?: string) {
  return prisma.team.findMany({
    where: playerId ? { members: { some: { playerId } } } : undefined,
    include: { members: true },
    orderBy: { name: 'asc' },
  });
}

async function assertNoOpenMatches(teamId: number) {
  const open = await prisma.match.findFirst({
    where: { status: { in: OPEN_STATUSES }, OR: [{ team1Id: teamId }, { team2Id: teamId }] },
  });
  if (open) throw new UserError(`O time tem uma partida em aberto (#${open.id}). Termine-a primeiro.`);
}

/** Sai do time. Se o capitão sair, a braçadeira passa para o membro mais antigo. */
export async function leaveTeam(name: string, playerId: string) {
  const team = await getTeamByName(name);
  const member = team.members.find((m) => m.playerId === playerId);
  if (!member) throw new UserError('Você não faz parte deste time.');
  await assertNoOpenMatches(team.id);
  const remaining = team.members.filter((m) => m.playerId !== playerId);
  if (remaining.length === 0) {
    await prisma.team.delete({ where: { id: team.id } });
    return { disbanded: true, newCaptainId: null };
  }
  await prisma.teamMember.delete({ where: { id: member.id } });
  let newCaptainId: string | null = null;
  if (team.captainId === playerId) {
    newCaptainId = remaining.sort((a, b) => a.id - b.id)[0].playerId;
    await prisma.team.update({ where: { id: team.id }, data: { captainId: newCaptainId } });
  }
  return { disbanded: false, newCaptainId };
}

export async function disbandTeam(name: string, requesterId: string, isAdmin: boolean) {
  const team = await getTeamByName(name);
  if (team.captainId !== requesterId && !isAdmin) throw new UserError('Só o capitão pode desfazer o time.');
  await assertNoOpenMatches(team.id);
  const entries = await prisma.tournamentEntry.count({
    where: { teamId: team.id, tournament: { status: { in: ['REGISTRATION', 'RUNNING'] } } },
  });
  if (entries > 0) throw new UserError('O time está inscrito em um campeonato em andamento.');
  await prisma.tournamentEntry.updateMany({ where: { teamId: team.id }, data: { teamId: null } });
  await prisma.team.delete({ where: { id: team.id } });
  return team;
}
