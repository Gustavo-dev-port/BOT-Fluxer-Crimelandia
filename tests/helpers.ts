import { prisma } from '../src/database/client.js';

/** Limpa todas as tabelas entre testes. */
export async function resetDb() {
  await prisma.$transaction([
    prisma.eventVote.deleteMany(),
    prisma.eventTeam.deleteMany(),
    prisma.weeklyEvent.deleteMany(),
    prisma.voiceRoom.deleteMany(),
    prisma.matchParticipant.deleteMany(),
    prisma.match.deleteMany(),
    prisma.tournamentEntry.deleteMany(),
    prisma.tournament.deleteMany(),
    prisma.teamMember.deleteMany(),
    prisma.team.deleteMany(),
    prisma.playerSeasonStats.deleteMany(),
    prisma.season.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.playerTitle.deleteMany(),
    prisma.playerAchievement.deleteMany(),
    prisma.tempRole.deleteMany(),
    prisma.tempNickname.deleteMany(),
    prisma.playerMission.deleteMany(),
    prisma.dailyMission.deleteMany(),
    prisma.player.deleteMany(),
    prisma.setting.deleteMany(),
    prisma.guildSettings.deleteMany(),
    prisma.reactionPrompt.deleteMany(),
    prisma.promotion.deleteMany(),
    prisma.freeGame.deleteMany(),
  ]);
}

export const p = (id: string) => ({ id, username: id });
